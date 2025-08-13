import { Octokit } from '@octokit/rest';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { debugChannel } from './debugChannel';
import { marked } from 'marked';

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

    async createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[]): Promise<any> {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Creating issue', { owner, repo, title });
            const response = await this.octokit!.rest.issues.create({
                owner,
                repo,
                title,
                body: body || '',
                labels: labels || []
            });

            debugChannel.info(`Created issue #${response.data.number}: ${title}`);
            return response.data;
        } catch (error) {
            debugChannel.error('Error creating issue', error as Error);
            throw error;
        }
    }

    async getRepositoryStats(owner: string, repo: string) {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Fetching repository stats', { owner, repo });
            const response = await this.octokit!.rest.repos.get({
                owner,
                repo
            });

            const stats = {
                stars: response.data.stargazers_count,
                forks: response.data.forks_count,
                watchers: response.data.watchers_count,
                openIssues: response.data.open_issues_count,
                language: response.data.language,
                description: response.data.description,
                homepage: response.data.homepage
            };

            debugChannel.info('Repository stats fetched', stats);
            return stats;
        } catch (error) {
            debugChannel.error('Error fetching repository stats', error as Error);
            throw error;
        }
    }

    async getGitStashes(workspacePath: string): Promise<string[]> {
        try {
            debugChannel.log('Getting git stashes', { workspacePath });
            const stashOutput = execSync('git stash list', {
                cwd: workspacePath,
                encoding: 'utf8',
                stdio: 'pipe'
            });

            const stashes = stashOutput.trim().split('\n').filter(line => line.length > 0);
            debugChannel.info(`Found ${stashes.length} stashes`);
            return stashes;
        } catch (error) {
            debugChannel.error('Error getting git stashes', error as Error);
            return [];
        }
    }

    async getUncommittedChanges(workspacePath: string): Promise<{ staged: string[], modified: string[], untracked: string[] }> {
        try {
            debugChannel.log('Getting uncommitted changes', { workspacePath });
            const statusOutput = execSync('git status --porcelain', {
                cwd: workspacePath,
                encoding: 'utf8',
                stdio: 'pipe'
            });

            const staged: string[] = [];
            const modified: string[] = [];
            const untracked: string[] = [];

            statusOutput.trim().split('\n').forEach(line => {
                if (line.length === 0) return;
                
                const status = line.substring(0, 2);
                const file = line.substring(3);

                if (status[0] !== ' ' && status[0] !== '?') {
                    staged.push(file);
                }
                if (status[1] === 'M' || status[1] === 'D') {
                    modified.push(file);
                }
                if (status === '??') {
                    untracked.push(file);
                }
            });

            const changes = { staged, modified, untracked };
            debugChannel.info('Uncommitted changes found', {
                staged: staged.length,
                modified: modified.length,
                untracked: untracked.length
            });
            return changes;
        } catch (error) {
            debugChannel.error('Error getting uncommitted changes', error as Error);
            return { staged: [], modified: [], untracked: [] };
        }
    }

    async getRecentActivity(owner: string, repo: string): Promise<any[]> {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Fetching recent activity', { owner, repo });
            
            // Get recent events from the repository
            const eventsResponse = await this.octokit!.rest.activity.listRepoEvents({
                owner,
                repo,
                per_page: 20
            });

            // Get recent commits
            const commitsResponse = await this.octokit!.rest.repos.listCommits({
                owner,
                repo,
                per_page: 10
            });

            // Combine and sort by date
            const activities: any[] = [];

            // Process events
            eventsResponse.data.forEach(event => {
                activities.push({
                    type: 'event',
                    eventType: event.type,
                    actor: event.actor,
                    created_at: event.created_at,
                    payload: event.payload,
                    id: event.id
                });
            });

            // Process commits
            commitsResponse.data.forEach(commit => {
                activities.push({
                    type: 'commit',
                    commit: commit,
                    author: commit.author,
                    created_at: commit.commit.author?.date || commit.commit.committer?.date,
                    message: commit.commit.message,
                    sha: commit.sha
                });
            });

            // Sort by date (most recent first)
            activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            debugChannel.info(`Fetched ${activities.length} recent activities`);
            return activities.slice(0, 15); // Return top 15 most recent
        } catch (error) {
            debugChannel.error('Error fetching recent activity', error as Error);
            throw error;
        }
    }

    async checkoutPRGitHubStyle(workspacePath: string, prNumber: number): Promise<void> {
        try {
            debugChannel.log('Checking out PR (GitHub style)', { workspacePath, prNumber });
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
            const headRepo = pr.head.repo;
            
            // GitHub CLI style: pr-{number} or {username}:{branch} format
            let targetBranchName: string;
            let remoteUrl: string;

            if (headRepo?.full_name === `${repoInfo.owner}/${repoInfo.repo}`) {
                // Same repo PR
                targetBranchName = branchName;
                remoteUrl = 'origin';
            } else {
                // Fork PR - use GitHub CLI style naming
                targetBranchName = `${pr.head.repo?.owner.login}:${branchName}`;
                remoteUrl = pr.head.repo?.clone_url || '';
            }

            debugChannel.log('GitHub style checkout details', { 
                targetBranchName, 
                remoteUrl, 
                isFromFork: headRepo?.full_name !== `${repoInfo.owner}/${repoInfo.repo}` 
            });

            // If it's a fork, add the remote
            if (headRepo?.full_name !== `${repoInfo.owner}/${repoInfo.repo}`) {
                const remoteName = `pr-${prNumber}`;
                try {
                    execSync(`git remote add ${remoteName} ${remoteUrl}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                    debugChannel.info(`Added remote: ${remoteName}`);
                } catch (error) {
                    // Remote might already exist, try to update it
                    try {
                        execSync(`git remote set-url ${remoteName} ${remoteUrl}`, {
                            cwd: workspacePath,
                            stdio: 'pipe'
                        });
                        debugChannel.info(`Updated remote: ${remoteName}`);
                    } catch (updateError) {
                        debugChannel.warn('Could not add/update remote', updateError as Error);
                    }
                }

                // Fetch the PR branch
                execSync(`git fetch ${remoteName} ${branchName}`, {
                    cwd: workspacePath,
                    stdio: 'pipe'
                });

                // Create and checkout local branch
                const localBranchName = `pr-${prNumber}`;
                try {
                    execSync(`git checkout -b ${localBranchName} ${remoteName}/${branchName}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                    debugChannel.info(`Created and checked out: ${localBranchName}`);
                } catch (error) {
                    // Branch might exist, just checkout
                    execSync(`git checkout ${localBranchName}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                    execSync(`git reset --hard ${remoteName}/${branchName}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                    debugChannel.info(`Checked out and updated: ${localBranchName}`);
                }
            } else {
                // Same repo - just checkout the branch
                execSync(`git fetch origin ${branchName}`, {
                    cwd: workspacePath,
                    stdio: 'pipe'
                });

                try {
                    execSync(`git checkout ${branchName}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                    debugChannel.info(`Checked out branch: ${branchName}`);
                } catch (error) {
                    // Create local tracking branch
                    execSync(`git checkout -b ${branchName} origin/${branchName}`, {
                        cwd: workspacePath,
                        stdio: 'pipe'
                    });
                    debugChannel.info(`Created and checked out tracking branch: ${branchName}`);
                }
            }

        } catch (error) {
            debugChannel.error('Error checking out PR (GitHub style)', error as Error);
            throw error;
        }
    }

    async getPRComments(owner: string, repo: string, prNumber: number): Promise<any[]> {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Fetching PR comments', { owner, repo, prNumber });
            
            // Get PR review comments (inline comments on code)
            const reviewCommentsResponse = await this.octokit!.rest.pulls.listReviewComments({
                owner,
                repo,
                pull_number: prNumber,
                per_page: 100
            });

            // Get PR issue comments (general discussion)
            const issueCommentsResponse = await this.octokit!.rest.issues.listComments({
                owner,
                repo,
                issue_number: prNumber,
                per_page: 100
            });

            // Combine and sort by creation date
            const allComments = [
                ...reviewCommentsResponse.data.map(comment => ({
                    ...comment,
                    comment_type: 'review',
                    body_html: this.renderMarkdown(comment.body || '')
                })),
                ...issueCommentsResponse.data.map(comment => ({
                    ...comment,
                    comment_type: 'issue',
                    body_html: this.renderMarkdown(comment.body || '')
                }))
            ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

            debugChannel.info(`Fetched ${allComments.length} PR comments`);
            return allComments;
        } catch (error) {
            debugChannel.error('Error fetching PR comments', error as Error);
            throw error;
        }
    }

    async addPRComment(owner: string, repo: string, prNumber: number, body: string): Promise<any> {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Adding PR comment', { owner, repo, prNumber });
            const response = await this.octokit!.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body
            });

            debugChannel.info(`PR comment added: #${response.data.id}`);
            return {
                ...response.data,
                body_html: this.renderMarkdown(response.data.body || '')
            };
        } catch (error) {
            debugChannel.error('Error adding PR comment', error as Error);
            throw error;
        }
    }

    renderMarkdown(text: string): string {
        try {
            // Configure marked for GitHub-flavored markdown
            marked.setOptions({
                gfm: true,
                breaks: true,
                sanitize: false // We'll handle sanitization in the webview
            });
            
            return marked(text);
        } catch (error) {
            debugChannel.error('Error rendering markdown', error as Error);
            return text; // Fallback to plain text
        }
    }

    async getPRDetails(owner: string, repo: string, prNumber: number): Promise<any> {
        if (!(await this.ensureAuthenticated())) {
            throw new Error('GitHub authentication failed');
        }

        try {
            debugChannel.log('Fetching PR details', { owner, repo, prNumber });
            const response = await this.octokit!.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber
            });

            const pr = response.data;
            return {
                ...pr,
                body_html: this.renderMarkdown(pr.body || ''),
                description_text: pr.body || ''
            };
        } catch (error) {
            debugChannel.error('Error fetching PR details', error as Error);
            throw error;
        }
    }

    generateCopyableContent(pr: any, comments: any[]): string {
        let content = `# PR #${pr.number}: ${pr.title}\n\n`;
        content += `**Author:** ${pr.user.login}\n`;
        content += `**Created:** ${new Date(pr.created_at).toLocaleDateString()}\n`;
        content += `**Status:** ${pr.state}\n`;
        content += `**Branch:** ${pr.head.ref} → ${pr.base.ref}\n\n`;
        
        if (pr.description_text) {
            content += `## Description\n\n${pr.description_text}\n\n`;
        }

        if (comments.length > 0) {
            content += `## Comments (${comments.length})\n\n`;
            comments.forEach(comment => {
                content += `### ${comment.user.login} - ${new Date(comment.created_at).toLocaleString()}\n`;
                if (comment.comment_type === 'review') {
                    content += `*Code Review Comment*\n`;
                }
                content += `${comment.body}\n\n---\n\n`;
            });
        }

        content += `*Generated from GitHub Dev Dashboard at ${new Date().toLocaleString()}*`;
        return content;
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