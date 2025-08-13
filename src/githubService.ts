import { Octokit } from '@octokit/rest';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { debugChannel } from './debugChannel';

export interface RepositoryInfo {
    owner: string;
    repo: string;
}

export class GitHubService {
    private octokit: Octokit | null = null;

    constructor() {
        this.initializeOctokit();
    }

    private async initializeOctokit() {
        try {
            debugChannel.log('Initializing GitHub authentication...');
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            this.octokit = new Octokit({
                auth: session.accessToken
            });
            debugChannel.info('GitHub authentication successful');
        } catch (error) {
            debugChannel.error('Failed to authenticate with GitHub', error as Error);
            vscode.window.showErrorMessage('Failed to authenticate with GitHub. Please sign in to your GitHub account in VS Code.');
        }
    }

    private async ensureAuthenticated(): Promise<boolean> {
        if (!this.octokit) {
            await this.initializeOctokit();
        }
        return this.octokit !== null;
    }

    async getRepositoryInfo(workspacePath: string): Promise<RepositoryInfo | null> {
        try {
            debugChannel.log('Getting repository info', { workspacePath });
            
            // Check if this is a git repository first
            try {
                execSync('git rev-parse --git-dir', { 
                    cwd: workspacePath,
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
            } catch (error) {
                debugChannel.warn('Not a git repository', { workspacePath });
                return null;
            }
            
            const remotesOutput = execSync('git remote -v', { 
                cwd: workspacePath,
                encoding: 'utf8' 
            });

            const fetchRemotes = remotesOutput
                .split('\n')
                .filter(line => line.includes('(fetch)'));

            for (const remote of fetchRemotes) {
                // Try to match github.com pattern first
                //let match = remote.match(/github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?[\s\t]/);
                let match = remote.match(/github.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?[\s\t]/);
                debugChannel.log('Remote pattern match attempt', { remote, match });
                if (match) {
                    const repoInfo = {
                        owner: match[1],
                        repo: match[2]
                    };
                    debugChannel.info('Repository info found', repoInfo);
                    return repoInfo;
                }

                // Try to match SSH alias pattern (alias:owner/repo)
                match = remote.match(/([^@\s]+)[@:]([^/]+)\/([^/\s]+?)(?:\.git)?[\s\t]/);
                if (match) {
                    // Check if this might be a GitHub alias by looking for typical patterns
                    const host = match[1];
                    const repo = match[2];
                    const owner = match[2].split(':').pop() || match[2]
                    // Skip if it looks like a non-GitHub host (has dots, common self-hosted patterns)
                    if (!host.includes('.') && !host.includes('gitlab') && !host.includes('bitbucket')) {
                        const repoInfo = {
                            owner: owner,
                            repo: match[3]
                        };
                        debugChannel.info('Repository info found via SSH alias', repoInfo);
                        return repoInfo;
                    }
                }
            }

            debugChannel.warn('No GitHub repository info found');
            return null;
        } catch (error) {
            debugChannel.error('Error getting repository info', error as Error);
            return null;
        }
    }

    async getIssues(owner: string, repo: string) {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Fetching issues', { owner, repo });
            const response = await this.octokit!.rest.issues.listForRepo({
                owner,
                repo,
                state: 'open',
                per_page: 100,
                sort: 'updated',
                direction: 'desc'
            });

            const issues = response.data.filter(issue => !issue.pull_request);
            debugChannel.info(`Fetched ${issues.length} issues`);
            return issues;
        } catch (error) {
            debugChannel.error('Error fetching issues', error as Error);
            throw error;
        }
    }

    async getPullRequests(owner: string, repo: string) {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Fetching pull requests', { owner, repo });
            const response = await this.octokit!.rest.pulls.list({
                owner,
                repo,
                state: 'open',
                per_page: 100,
                sort: 'updated',
                direction: 'desc'
            });

            debugChannel.info(`Fetched ${response.data.length} pull requests`);
            return response.data;
        } catch (error) {
            debugChannel.error('Error fetching pull requests', error as Error);
            throw error;
        }
    }

    async getCurrentUser() {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Fetching current user');
            const response = await this.octokit!.rest.users.getAuthenticated();
            debugChannel.info(`Current user: ${response.data.login}`);
            return response.data;
        } catch (error) {
            debugChannel.error('Error fetching current user', error as Error);
            throw error;
        }
    }

    async switchAccount(): Promise<void> {
        try {
            debugChannel.log('Switching GitHub account...');
            
            // Clear current authentication
            this.octokit = null;
            
            // Force new authentication session
            const session = await vscode.authentication.getSession('github', ['repo'], { 
                forceNewSession: true
            });
            
            this.octokit = new Octokit({
                auth: session.accessToken
            });
            
            debugChannel.info('GitHub account switched successfully');
        } catch (error) {
            debugChannel.error('Error switching GitHub account', error as Error);
            throw error;
        }
    }

    async checkRepositoryAccess(owner: string, repo: string): Promise<{ hasAccess: boolean; permissions: any }> {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Checking repository access', { owner, repo });
            
            // Try to get repository information to check access
            await this.octokit!.rest.repos.get({
                owner,
                repo
            });

            // If we can get the repo, check our permissions
            try {
                const permResponse = await this.octokit!.rest.repos.getCollaboratorPermissionLevel({
                    owner,
                    repo,
                    username: (await this.getCurrentUser()).login
                });
                
                debugChannel.info('Repository access confirmed', { 
                    owner, 
                    repo, 
                    permission: permResponse.data.permission 
                });
                
                return {
                    hasAccess: true,
                    permissions: permResponse.data
                };
            } catch (permError) {
                // If we can't get permission info, but can see the repo, we likely have read access
                debugChannel.info('Repository is accessible (public or read access)', { owner, repo });
                return {
                    hasAccess: true,
                    permissions: { permission: 'read' }
                };
            }
        } catch (error: any) {
            if (error.status === 404) {
                debugChannel.warn('Repository not found or no access', { owner, repo });
                return {
                    hasAccess: false,
                    permissions: null
                };
            }
            debugChannel.error('Error checking repository access', error as Error);
            throw error;
        }
    }

    async checkoutPR(workspacePath: string, prNumber: number): Promise<void> {
        try {
            debugChannel.log('Checking out PR', { workspacePath, prNumber });
            const repoInfo = await this.getRepositoryInfo(workspacePath);
            if (!repoInfo) {
                throw new Error('Could not determine repository information');
            }

            if (!(await this.ensureAuthenticated())) {
                throw new Error('GitHub authentication failed');
            }

            const prResponse = await this.octokit!.rest.pulls.get({
                owner: repoInfo.owner,
                repo: repoInfo.repo,
                pull_number: prNumber
            });

            const pr = prResponse.data;
            const branchName = pr.head.ref;
            const remoteName = pr.head.repo?.full_name === `${repoInfo.owner}/${repoInfo.repo}` 
                ? 'origin' 
                : 'pr-remote';

            if (remoteName === 'pr-remote') {
                try {
                    execSync(`git remote add ${remoteName} ${pr.head.repo?.clone_url}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                } catch (error) {
                    execSync(`git remote set-url ${remoteName} ${pr.head.repo?.clone_url}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                }
            }

            execSync(`git fetch ${remoteName} ${branchName}`, {
                cwd: workspacePath,
                stdio: 'pipe'
            });

            const localBranchName = `pr-${prNumber}-${branchName}`;
            debugChannel.log('Creating local branch', { localBranchName, remoteName, branchName });
            
            try {
                execSync(`git checkout -b ${localBranchName} ${remoteName}/${branchName}`, {
                    cwd: workspacePath,
                    stdio: 'pipe'
                });
                debugChannel.info(`Created and checked out new branch: ${localBranchName}`);
            } catch (error) {
                execSync(`git checkout ${localBranchName}`, {
                    cwd: workspacePath,
                    stdio: 'pipe'
                });
                debugChannel.info(`Checked out existing branch: ${localBranchName}`);
            }

        } catch (error) {
            debugChannel.error('Error checking out PR', error as Error);
            throw error;
        }
    }
}