import * as vscode from 'vscode';
import { GitHubService } from './githubService';
import { debugChannel } from './debugChannel';

export class devDashProvider {
    public static readonly viewType = 'devDash.view';
    private static _currentPanel: vscode.WebviewPanel | undefined;

    private githubService: GitHubService;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.githubService = new GitHubService();
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        debugChannel.log('Creating or showing GitHub Viewer panel');
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (devDashProvider._currentPanel) {
            debugChannel.log('Revealing existing panel');
            devDashProvider._currentPanel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            devDashProvider.viewType,
            'GitHub Issues & PRs',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'out/compiled')
                ]
            }
        );

        devDashProvider._currentPanel = panel;
        const provider = new devDashProvider(extensionUri);
        provider._update(panel.webview, extensionUri);
        debugChannel.info('GitHub Viewer panel created successfully');

        panel.onDidDispose(() => {
            debugChannel.log('GitHub Viewer panel disposed');
            devDashProvider._currentPanel = undefined;
        }, null);

        panel.webview.onDidReceiveMessage(
            async message => {
                await provider._handleMessage(message);
            },
            undefined
        );
    }

    private async _handleMessage(message: any) {
        debugChannel.log('Received message from webview', { type: message.type });
        switch (message.type) {
            case 'loadData':
                await this._loadGitHubData();
                break;
            case 'refreshIssues':
                await this._refreshIssues();
                break;
            case 'refreshPRs':
                await this._refreshPRs();
                break;
            case 'viewDetails':
                await this._viewItemDetails(message.item);
                break;
            case 'checkoutPR':
                await this._checkoutPR(message.prNumber);
                break;
            case 'switchAccount':
                await this._switchAccount();
                break;
            case 'createIssue':
                await this._createIssue(message.title, message.body, message.labels, message.assignees);
                break;
            case 'loadCollaborators':
                await this._loadCollaborators();
                break;
            case 'checkoutIssueBranch':
                await this._checkoutIssueBranch(message.issueNumber, message.branchName);
                break;
            case 'loadLocal':
                await this._loadLocalData();
                break;
            case 'loadActivity':
                await this._loadActivity();
                break;
            case 'checkoutPRGitHub':
                await this._checkoutPRGitHubStyle(message.prNumber);
                break;
            case 'loadPRDetails':
                await this._loadPRDetails(message.prNumber);
                break;
            case 'loadPRComments':
                await this._loadPRComments(message.prNumber);
                break;
            case 'addPRComment':
                await this._addPRComment(message.prNumber, message.body);
                break;
            case 'copyPRContent':
                await this._copyPRContent(message.prNumber);
                break;
            default:
                debugChannel.warn('Unknown message type received', message.type);
        }
    }

    private async _loadGitHubData() {
        try {
            debugChannel.log('Loading GitHub data...');
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                vscode.window.showErrorMessage('Not a Git repository or no GitHub remote found!');
                return;
            }

            // Check repository access first
            const accessCheck = await this.githubService.checkRepositoryAccess(repoInfo.owner, repoInfo.repo);
            if (!accessCheck.hasAccess) {
                debugChannel.warn('No access to repository', { owner: repoInfo.owner, repo: repoInfo.repo });
                const user = await this.githubService.getCurrentUser();
                this._sendMessage({
                    type: 'accessDenied',
                    user,
                    repository: `${repoInfo.owner}/${repoInfo.repo}`
                });
                return;
            }

            const [user, issues, prs, stats] = await Promise.all([
                this.githubService.getCurrentUser(),
                this.githubService.getIssues(repoInfo.owner, repoInfo.repo),
                this.githubService.getPullRequests(repoInfo.owner, repoInfo.repo),
                this.githubService.getRepositoryStats(repoInfo.owner, repoInfo.repo)
            ]);

            // Add markdown rendering to issues and PRs
            const processedIssues = issues.map(issue => ({
                ...issue,
                body_html: this.githubService.renderMarkdown(issue.body || ''),
                body_preview: this._createPreview(issue.body || '')
            }));

            const processedPRs = prs.map(pr => ({
                ...pr,
                body_html: this.githubService.renderMarkdown(pr.body || ''),
                body_preview: this._createPreview(pr.body || '')
            }));

            this._sendMessage({
                type: 'dataLoaded',
                user,
                issues: processedIssues,
                prs: processedPRs,
                stats,
                repository: `${repoInfo.owner}/${repoInfo.repo}`
            });
            debugChannel.info('GitHub data loaded and sent to webview');
        } catch (error: any) {
            debugChannel.error('Error loading GitHub data', error as Error);
            
            // Handle authentication errors specifically
            if (error.message?.includes('authentication') || error.status === 401) {
                this._sendMessage({
                    type: 'authenticationError',
                    message: 'GitHub authentication failed. Please try switching accounts.'
                });
                vscode.window.showErrorMessage('GitHub authentication failed. Please try switching accounts.');
            } else if (error.status === 403) {
                this._sendMessage({
                    type: 'accessDenied',
                    repository: 'Current Repository',
                    user: { login: 'Current User' }
                });
                vscode.window.showErrorMessage('Access denied to repository. Please check your permissions or switch accounts.');
            } else {
                vscode.window.showErrorMessage(`Error loading GitHub data: ${error.message || error}`);
            }
        }
    }

    private async _refreshIssues() {
        try {
            debugChannel.log('Refreshing issues...');
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                return;
            }

            const issues = await this.githubService.getIssues(repoInfo.owner, repoInfo.repo);
            
            this._sendMessage({
                type: 'issuesRefreshed',
                issues
            });
            debugChannel.info('Issues refreshed and sent to webview');
        } catch (error) {
            debugChannel.error('Error refreshing issues', error as Error);
            vscode.window.showErrorMessage(`Error refreshing issues: ${error}`);
        }
    }

    private async _refreshPRs() {
        try {
            debugChannel.log('Refreshing pull requests...');
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                return;
            }

            const prs = await this.githubService.getPullRequests(repoInfo.owner, repoInfo.repo);
            
            this._sendMessage({
                type: 'prsRefreshed',
                prs
            });
            debugChannel.info('Pull requests refreshed and sent to webview');
        } catch (error) {
            debugChannel.error('Error refreshing pull requests', error as Error);
            vscode.window.showErrorMessage(`Error refreshing pull requests: ${error}`);
        }
    }

    private async _viewItemDetails(item: any) {
        debugChannel.log('Viewing item details', { type: item.type, number: item.number });
        const panel = vscode.window.createWebviewPanel(
            'githubItemDetails',
            `${item.type === 'issue' ? 'Issue' : 'PR'} #${item.number}`,
            vscode.ViewColumn.Two,
            {
                enableScripts: true
            }
        );

        panel.webview.html = this._getDetailsHtml(item);
    }

    private async _checkoutPR(prNumber: number) {
        try {
            debugChannel.log('Attempting to checkout PR', { prNumber });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found for PR checkout');
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            await this.githubService.checkoutPR(workspaceFolder.uri.fsPath, prNumber);
            debugChannel.info(`Successfully checked out PR #${prNumber}`);
            vscode.window.showInformationMessage(`Checked out PR #${prNumber}`);
        } catch (error) {
            debugChannel.error('Error checking out PR', error as Error);
            vscode.window.showErrorMessage(`Error checking out PR: ${error}`);
        }
    }

    private async _createIssue(title: string, body?: string, labels?: string[], assignees?: string[]) {
        try {
            debugChannel.log('Creating new issue', { title });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                vscode.window.showErrorMessage('Not a Git repository or no GitHub remote found!');
                return;
            }

            // Check if user has permission to create issues
            const accessCheck = await this.githubService.checkRepositoryAccess(repoInfo.owner, repoInfo.repo);
            if (!accessCheck.hasAccess || (accessCheck.permissions.permission === 'read')) {
                debugChannel.warn('Insufficient permissions to create issues', { 
                    owner: repoInfo.owner, 
                    repo: repoInfo.repo,
                    permission: accessCheck.permissions?.permission
                });
                vscode.window.showErrorMessage('You do not have permission to create issues in this repository');
                return;
            }

            const issue = await this.githubService.createIssue(repoInfo.owner, repoInfo.repo, title, body, labels, assignees);
            debugChannel.info(`Issue created successfully: #${issue.number}`);
            
            this._sendMessage({
                type: 'issueCreated',
                issue
            });
            
            // Refresh issues to show the new one
            await this._refreshIssues();
            vscode.window.showInformationMessage(`Issue #${issue.number} created successfully!`);
        } catch (error) {
            debugChannel.error('Error creating issue', error as Error);
            vscode.window.showErrorMessage(`Error creating issue: ${error}`);
        }
    }

    private async _loadLocalData() {
        try {
            debugChannel.log('Loading local git data...');
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const [stashes, changes] = await Promise.all([
                this.githubService.getGitStashes(workspaceFolder.uri.fsPath),
                this.githubService.getUncommittedChanges(workspaceFolder.uri.fsPath)
            ]);

            this._sendMessage({
                type: 'localDataLoaded',
                stashes,
                changes
            });
            debugChannel.info('Local git data loaded and sent to webview');
        } catch (error) {
            debugChannel.error('Error loading local data', error as Error);
            vscode.window.showErrorMessage(`Error loading local data: ${error}`);
        }
    }

    private async _loadActivity() {
        try {
            debugChannel.log('Loading recent activity...');
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                vscode.window.showErrorMessage('Not a Git repository or no GitHub remote found!');
                return;
            }

            const activity = await this.githubService.getRecentActivity(repoInfo.owner, repoInfo.repo);
            
            this._sendMessage({
                type: 'activityLoaded',
                activity
            });
            debugChannel.info('Recent activity loaded and sent to webview');
        } catch (error) {
            debugChannel.error('Error loading activity', error as Error);
            vscode.window.showErrorMessage(`Error loading activity: ${error}`);
        }
    }

    private async _checkoutPRGitHubStyle(prNumber: number) {
        try {
            debugChannel.log('Attempting GitHub-style PR checkout', { prNumber });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found for PR checkout');
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            await this.githubService.checkoutPRGitHubStyle(workspaceFolder.uri.fsPath, prNumber);
            debugChannel.info(`Successfully checked out PR #${prNumber} (GitHub style)`);
            vscode.window.showInformationMessage(`Checked out PR #${prNumber} using GitHub CLI style`);
        } catch (error) {
            debugChannel.error('Error checking out PR (GitHub style)', error as Error);
            vscode.window.showErrorMessage(`Error checking out PR: ${error}`);
        }
    }

    private async _loadPRDetails(prNumber: number) {
        try {
            debugChannel.log('Loading PR details', { prNumber });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                return;
            }

            const prDetails = await this.githubService.getPRDetails(repoInfo.owner, repoInfo.repo, prNumber);
            
            this._sendMessage({
                type: 'prDetailsLoaded',
                prDetails
            });
            debugChannel.info('PR details loaded and sent to webview');
        } catch (error) {
            debugChannel.error('Error loading PR details', error as Error);
            vscode.window.showErrorMessage(`Error loading PR details: ${error}`);
        }
    }

    private async _loadPRComments(prNumber: number) {
        try {
            debugChannel.log('Loading PR comments', { prNumber });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                return;
            }

            const comments = await this.githubService.getPRComments(repoInfo.owner, repoInfo.repo, prNumber);
            
            this._sendMessage({
                type: 'prCommentsLoaded',
                comments,
                prNumber
            });
            debugChannel.info(`PR comments loaded: ${comments.length} comments`);
        } catch (error) {
            debugChannel.error('Error loading PR comments', error as Error);
            vscode.window.showErrorMessage(`Error loading PR comments: ${error}`);
        }
    }

    private async _addPRComment(prNumber: number, body: string) {
        try {
            debugChannel.log('Adding PR comment', { prNumber });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                return;
            }

            const comment = await this.githubService.addPRComment(repoInfo.owner, repoInfo.repo, prNumber, body);
            
            this._sendMessage({
                type: 'prCommentAdded',
                comment,
                prNumber
            });
            debugChannel.info(`PR comment added: #${comment.id}`);
            vscode.window.showInformationMessage('Comment added successfully!');
        } catch (error) {
            debugChannel.error('Error adding PR comment', error as Error);
            vscode.window.showErrorMessage(`Error adding comment: ${error}`);
        }
    }

    private async _copyPRContent(prNumber: number) {
        try {
            debugChannel.log('Copying PR content', { prNumber });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                return;
            }

            const [prDetails, comments] = await Promise.all([
                this.githubService.getPRDetails(repoInfo.owner, repoInfo.repo, prNumber),
                this.githubService.getPRComments(repoInfo.owner, repoInfo.repo, prNumber)
            ]);

            const copyableContent = this.githubService.generateCopyableContent(prDetails, comments);
            
            await vscode.env.clipboard.writeText(copyableContent);
            vscode.window.showInformationMessage(`PR #${prNumber} content copied to clipboard!`);
            debugChannel.info(`PR content copied to clipboard: ${copyableContent.length} characters`);
        } catch (error) {
            debugChannel.error('Error copying PR content', error as Error);
            vscode.window.showErrorMessage(`Error copying PR content: ${error}`);
        }
    }

    private async _loadCollaborators() {
        try {
            debugChannel.log('Loading repository collaborators...');
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found');
                return;
            }

            const repoInfo = await this.githubService.getRepositoryInfo(workspaceFolder.uri.fsPath);
            if (!repoInfo) {
                debugChannel.warn('No GitHub repository info found');
                return;
            }

            const collaborators = await this.githubService.getRepositoryCollaborators(repoInfo.owner, repoInfo.repo);
            
            this._sendMessage({
                type: 'collaboratorsLoaded',
                collaborators
            });
            debugChannel.info(`Collaborators loaded: ${collaborators.length}`);
        } catch (error) {
            debugChannel.error('Error loading collaborators', error as Error);
            this._sendMessage({
                type: 'collaboratorsLoaded',
                collaborators: []
            });
        }
    }

    private async _checkoutIssueBranch(issueNumber: number, branchName: string) {
        try {
            debugChannel.log('Checking out issue branch', { issueNumber, branchName });
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                debugChannel.warn('No workspace folder found for issue branch checkout');
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            await this.githubService.checkoutIssueBranch(workspaceFolder.uri.fsPath, branchName);
            debugChannel.info(`Successfully created/checked out branch: ${branchName} for issue #${issueNumber}`);
            vscode.window.showInformationMessage(`Created/checked out branch "${branchName}" for issue #${issueNumber}`);
        } catch (error) {
            debugChannel.error('Error checking out issue branch', error as Error);
            vscode.window.showErrorMessage(`Error checking out branch: ${error}`);
        }
    }

    private async _switchAccount() {
        try {
            debugChannel.log('Attempting to switch GitHub account');
            await this.githubService.switchAccount();
            debugChannel.info('GitHub account switched successfully');
            
            // Reload data with new account
            await this._loadGitHubData();
            vscode.window.showInformationMessage('GitHub account switched successfully');
        } catch (error) {
            debugChannel.error('Error switching GitHub account', error as Error);
            vscode.window.showErrorMessage(`Error switching GitHub account: ${error}`);
        }
    }

    private _createPreview(text: string): string {
        if (!text) return '';
        // Remove markdown syntax and create a plain text preview
        let preview = text
            .replace(/[#*`_\[\]()]/g, '') // Remove basic markdown chars
            .replace(/\n+/g, ' ') // Replace newlines with spaces
            .trim();
        
        // Truncate to 150 characters
        if (preview.length > 150) {
            preview = preview.substring(0, 147) + '...';
        }
        
        return preview;
    }

    private _sendMessage(message: any) {
        if (devDashProvider._currentPanel) {
            devDashProvider._currentPanel.webview.postMessage(message);
        }
    }

    private _update(webview: vscode.Webview, extensionUri: vscode.Uri) {
        webview.html = this._getHtmlForWebview(webview, extensionUri);
    }

    private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>GitHub Issues & PRs</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 16px;
                }
                .header {
                    margin-bottom: 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .user-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                .user-avatar {
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    border: 1px solid var(--vscode-panel-border);
                }
                .switch-account-btn {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.8em;
                    margin-left: 8px;
                }
                .switch-account-btn:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .access-denied {
                    text-align: center;
                    padding: 40px;
                    color: var(--vscode-errorForeground);
                }
                .access-denied h3 {
                    color: var(--vscode-errorForeground);
                    margin-bottom: 16px;
                }
                .access-denied p {
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 20px;
                }
                .refresh-btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .refresh-btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .tabs {
                    display: flex;
                    margin-bottom: 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    align-items: center;
                }
                .tab {
                    padding: 8px 16px;
                    cursor: pointer;
                    border: none;
                    background: none;
                    color: var(--vscode-foreground);
                }
                .tab.active {
                    border-bottom: 2px solid var(--vscode-focusBorder);
                }
                .tab-refresh {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.8em;
                    margin-left: 8px;
                }
                .tab-refresh:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 16px;
                }
                .item {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 16px;
                    background-color: var(--vscode-editor-background);
                    cursor: pointer;
                    transition: border-color 0.2s;
                }
                .item:hover {
                    border-color: var(--vscode-focusBorder);
                }
                .item-title {
                    font-weight: bold;
                    margin-bottom: 8px;
                    color: var(--vscode-textLink-foreground);
                }
                .item-meta {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                }
                .item-preview {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    margin: 6px 0;
                    line-height: 1.4;
                    font-style: italic;
                }
                .item-labels {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                    margin-top: 8px;
                }
                .label {
                    font-size: 0.8em;
                    padding: 2px 6px;
                    border-radius: 12px;
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                }
                .priority-high {
                    border-left: 4px solid #f85149;
                    background-color: rgba(248, 81, 73, 0.1);
                }
                .priority-medium {
                    border-left: 4px solid #fb8500;
                    background-color: rgba(251, 133, 0, 0.1);
                }
                .priority-low {
                    border-left: 4px solid #7c3aed;
                    background-color: rgba(124, 58, 237, 0.1);
                }
                .author-info {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 4px;
                }
                .author-avatar {
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    border: 1px solid var(--vscode-panel-border);
                }
                .loading {
                    text-align: center;
                    padding: 40px;
                    color: var(--vscode-descriptionForeground);
                }
                .actions {
                    margin-top: 12px;
                    display: flex;
                    gap: 8px;
                }
                .checkout-buttons {
                    display: flex;
                    gap: 6px;
                    margin-top: 8px;
                }
                .issue-actions {
                    display: flex;
                    gap: 6px;
                    margin-top: 8px;
                }
                .action-btn {
                    padding: 4px 8px;
                    border: 1px solid var(--vscode-button-border);
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.8em;
                }
                .action-btn:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .create-issue-btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.9em;
                    margin-left: 8px;
                }
                .create-issue-btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .modal {
                    display: none;
                    position: fixed;
                    z-index: 1000;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.5);
                }
                .modal-content {
                    background-color: var(--vscode-editor-background);
                    margin: 5% auto;
                    padding: 20px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    width: 80%;
                    max-width: 600px;
                }
                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 10px;
                }
                .modal-title {
                    font-size: 1.2em;
                    font-weight: bold;
                }
                .close {
                    color: var(--vscode-descriptionForeground);
                    font-size: 28px;
                    font-weight: bold;
                    cursor: pointer;
                }
                .close:hover {
                    color: var(--vscode-foreground);
                }
                .form-group {
                    margin-bottom: 16px;
                }
                .form-label {
                    display: block;
                    margin-bottom: 4px;
                    font-weight: bold;
                    color: var(--vscode-foreground);
                }
                .form-input, .form-textarea {
                    width: 100%;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-family: var(--vscode-font-family);
                    box-sizing: border-box;
                }
                .form-textarea {
                    resize: vertical;
                    min-height: 100px;
                }
                .form-input:focus, .form-textarea:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                .modal-actions {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                }
                .btn-primary {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .btn-primary:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .btn-secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .btn-secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .repo-stats {
                    display: flex;
                    gap: 16px;
                    margin-top: 8px;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                .stat {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .stat-icon {
                    font-size: 1.1em;
                }
                .local-section {
                    margin-bottom: 20px;
                }
                .local-section h3 {
                    margin-bottom: 10px;
                    color: var(--vscode-foreground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 5px;
                }
                .changes-list, .stashes-list {
                    background-color: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    padding: 12px;
                    border-radius: 4px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 0.9em;
                }
                .file-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 4px;
                }
                .file-status {
                    width: 20px;
                    font-weight: bold;
                }
                .file-status.staged { color: #4caf50; }
                .file-status.modified { color: #ff9800; }
                .file-status.untracked { color: #f44336; }
                .docs-content {
                    line-height: 1.6;
                }
                .docs-content h3 {
                    color: var(--vscode-textLink-foreground);
                    margin-top: 20px;
                    margin-bottom: 10px;
                }
                .docs-content p {
                    margin-bottom: 12px;
                }
                .docs-content ul {
                    margin-bottom: 12px;
                    padding-left: 20px;
                }
                .docs-content li {
                    margin-bottom: 4px;
                }
                .search-container {
                    margin-bottom: 16px;
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }
                .search-input {
                    flex: 1;
                    padding: 6px 12px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-size: 0.9em;
                }
                .search-input:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                .filter-select {
                    padding: 6px 8px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-size: 0.9em;
                }
                .filter-select:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                .activity-item {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 12px;
                    margin-bottom: 8px;
                    background-color: var(--vscode-editor-background);
                }
                .activity-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 6px;
                }
                .activity-icon {
                    width: 16px;
                    height: 16px;
                    font-size: 0.9em;
                }
                .activity-actor {
                    font-weight: bold;
                    color: var(--vscode-textLink-foreground);
                }
                .activity-time {
                    font-size: 0.8em;
                    color: var(--vscode-descriptionForeground);
                    margin-left: auto;
                }
                .activity-content {
                    font-size: 0.9em;
                    color: var(--vscode-foreground);
                }
                .activity-commit {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 0.8em;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 4px;
                }
                .github-checkout-btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.8em;
                    margin-left: 4px;
                }
                .github-checkout-btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h2 id="repo-title">GitHub Dev Dashboard</h2>
                    <div class="repo-stats" id="repo-stats" style="display: none;">
                        <span class="stat"><span class="stat-icon">⭐</span><span id="stars">0</span></span>
                        <span class="stat"><span class="stat-icon">🍴</span><span id="forks">0</span></span>
                        <span class="stat"><span class="stat-icon">👀</span><span id="watchers">0</span></span>
                        <span class="stat"><span class="stat-icon">🐛</span><span id="open-issues">0</span></span>
                    </div>
                    <button class="refresh-btn" onclick="loadData()">Refresh</button>
                </div>
                <div class="user-info" id="user-info" style="display: none;">
                    <img class="user-avatar" id="user-avatar" src="" alt="User Avatar">
                    <span id="user-name">Loading...</span>
                    <button class="switch-account-btn" onclick="switchAccount()" title="Switch GitHub Account">Switch</button>
                </div>
            </div>
            
            <div class="tabs">
                <button class="tab active" onclick="showTab('issues')">Issues</button>
                <button class="tab-refresh" onclick="refreshIssues()">↻</button>
                <button class="create-issue-btn" onclick="openCreateIssueModal()">+ Create Issue</button>
                <button class="tab" onclick="showTab('prs')">Pull Requests</button>
                <button class="tab-refresh" onclick="refreshPRs()">↻</button>
                <button class="tab" onclick="showTab('activity')">Activity</button>
                <button class="tab-refresh" onclick="loadActivity()">↻</button>
                <button class="tab" onclick="showTab('local')">Local</button>
                <button class="tab-refresh" onclick="loadLocal()">↻</button>
                <button class="tab" onclick="showTab('docs')">Documentation</button>
            </div>
            
            <div id="issues-tab" class="tab-content">
                <div class="search-container">
                    <input type="text" id="issues-search" class="search-input" placeholder="Search issues by title, author, or labels...">
                    <select id="issues-status-filter" class="filter-select">
                        <option value="">All Status</option>
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                    </select>
                </div>
                <div id="issues-grid" class="grid">
                    <div class="loading">Loading issues...</div>
                </div>
            </div>
            
            <div id="prs-tab" class="tab-content" style="display: none;">
                <div class="search-container">
                    <input type="text" id="prs-search" class="search-input" placeholder="Search PRs by title, author, or branch...">
                    <select id="prs-status-filter" class="filter-select">
                        <option value="">All Status</option>
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                        <option value="merged">Merged</option>
                    </select>
                </div>
                <div id="prs-grid" class="grid">
                    <div class="loading">Loading pull requests...</div>
                </div>
            </div>

            <div id="activity-tab" class="tab-content" style="display: none;">
                <div id="activity-list">
                    <div class="loading">Loading recent activity...</div>
                </div>
            </div>

            <div id="local-tab" class="tab-content" style="display: none;">
                <div class="local-section">
                    <h3>Git Stashes</h3>
                    <div id="stashes-list" class="stashes-list">
                        <div class="loading">Loading stashes...</div>
                    </div>
                </div>
                <div class="local-section">
                    <h3>Uncommitted Changes</h3>
                    <div id="changes-list" class="changes-list">
                        <div class="loading">Loading changes...</div>
                    </div>
                </div>
            </div>

            <div id="docs-tab" class="tab-content" style="display: none;">
                <div class="docs-content">
                    <h3>🚀 GitHub Dev Dashboard</h3>
                    <p>A comprehensive VS Code extension for managing GitHub repositories directly from your editor.</p>
                    
                    <h3>📋 Features</h3>
                    <ul>
                        <li><strong>Issues Management:</strong> View, create, and track GitHub issues</li>
                        <li><strong>Pull Requests:</strong> Browse PRs and checkout branches locally</li>
                        <li><strong>Repository Stats:</strong> View stars, forks, watchers, and open issues</li>
                        <li><strong>Local Git Operations:</strong> Monitor stashes and uncommitted changes</li>
                        <li><strong>Account Management:</strong> Switch between GitHub accounts</li>
                        <li><strong>Permission-based Actions:</strong> Smart UI based on repository access</li>
                    </ul>

                    <h3>🎯 How to Use</h3>
                    <ul>
                        <li><strong>Issues Tab:</strong> View all open issues, create new ones with the "+ Create Issue" button</li>
                        <li><strong>Pull Requests Tab:</strong> Browse PRs, checkout branches with the "Checkout" button</li>
                        <li><strong>Local Tab:</strong> Monitor your git stashes and uncommitted file changes</li>
                        <li><strong>Repository Stats:</strong> View repository metrics in the header section</li>
                        <li><strong>Account Switching:</strong> Use the "Switch" button to change GitHub accounts</li>
                    </ul>

                    <h3>🔧 Requirements</h3>
                    <ul>
                        <li>VS Code with GitHub authentication enabled</li>
                        <li>Git repository with GitHub remote</li>
                        <li>Internet connection for GitHub API access</li>
                    </ul>

                    <h3>💡 Tips</h3>
                    <ul>
                        <li>Use refresh buttons (↻) to update individual sections</li>
                        <li>Click on any issue or PR to view detailed information</li>
                        <li>Labels and metadata are automatically synced from GitHub</li>
                        <li>All actions respect your GitHub repository permissions</li>
                    </ul>
                </div>
            </div>

            <div id="access-denied" class="access-denied" style="display: none;">
                <h3>⚠️ Access Denied</h3>
                <p>You don't have access to this repository with the current GitHub account.</p>
                <p><strong>Repository:</strong> <span id="denied-repo"></span></p>
                <p><strong>Current User:</strong> <span id="denied-user"></span></p>
                <button class="refresh-btn" onclick="switchAccount()">Switch GitHub Account</button>
            </div>

            <!-- Create Issue Modal -->
            <div id="create-issue-modal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <span class="modal-title">Create New Issue</span>
                        <span class="close" onclick="closeCreateIssueModal()">&times;</span>
                    </div>
                    <form id="create-issue-form">
                        <div class="form-group">
                            <label class="form-label" for="issue-title">Title *</label>
                            <input type="text" id="issue-title" class="form-input" required placeholder="Brief description of the issue">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="issue-body">Description</label>
                            <textarea id="issue-body" class="form-textarea" placeholder="Provide more details about the issue (optional)"></textarea>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="issue-labels">Labels</label>
                            <input type="text" id="issue-labels" class="form-input" placeholder="bug, enhancement, documentation (comma-separated)">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="issue-assignees">Assignees</label>
                            <select id="issue-assignees" class="form-input" multiple size="4">
                                <option value="">Loading collaborators...</option>
                            </select>
                            <small style="color: var(--vscode-descriptionForeground); margin-top: 4px; display: block;">Hold Ctrl/Cmd to select multiple assignees</small>
                        </div>
                        <div class="modal-actions">
                            <button type="button" class="btn-secondary" onclick="closeCreateIssueModal()">Cancel</button>
                            <button type="submit" class="btn-primary">Create Issue</button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Checkout Branch Dialog -->
            <div id="checkout-dialog" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <span class="modal-title">Checkout Branch for Issue</span>
                        <span class="close" onclick="closeCheckoutDialog()">&times;</span>
                    </div>
                    <div id="checkout-content">
                        <p>Create and checkout a new branch for issue <strong id="checkout-issue-number"></strong>:</p>
                        <div class="form-group">
                            <label class="form-label" for="branch-name">Branch Name:</label>
                            <input type="text" id="branch-name" class="form-input" placeholder="issue-123-feature-branch">
                            <small style="color: var(--vscode-descriptionForeground); margin-top: 4px; display: block;">
                                Use lowercase letters, numbers, and hyphens only
                            </small>
                        </div>
                        <div class="modal-actions">
                            <button type="button" class="btn-secondary" onclick="closeCheckoutDialog()">Cancel</button>
                            <button type="button" class="btn-primary" onclick="confirmCheckout()">Checkout Branch</button>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentData = { issues: [], prs: [] };

                function loadData() {
                    hideAccessDenied();
                    vscode.postMessage({ type: 'loadData' });
                }

                function refreshIssues() {
                    document.getElementById('issues-grid').innerHTML = '<div class="loading">Loading issues...</div>';
                    vscode.postMessage({ type: 'refreshIssues' });
                }

                function refreshPRs() {
                    document.getElementById('prs-grid').innerHTML = '<div class="loading">Loading pull requests...</div>';
                    vscode.postMessage({ type: 'refreshPRs' });
                }

                function switchAccount() {
                    hideAccessDenied();
                    document.getElementById('issues-grid').innerHTML = '<div class="loading">Switching account...</div>';
                    document.getElementById('prs-grid').innerHTML = '<div class="loading">Switching account...</div>';
                    vscode.postMessage({ type: 'switchAccount' });
                }

                function showAccessDenied(repository, user) {
                    document.getElementById('denied-repo').textContent = repository;
                    document.getElementById('denied-user').textContent = user;
                    document.getElementById('access-denied').style.display = 'block';
                    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
                }

                function hideAccessDenied() {
                    document.getElementById('access-denied').style.display = 'none';
                    document.getElementById('issues-tab').style.display = 'block';
                }

                function showTab(tabName) {
                    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
                    
                    event.target.classList.add('active');
                    document.getElementById(tabName + '-tab').style.display = 'block';
                }

                function viewDetails(item) {
                    vscode.postMessage({ type: 'viewDetails', item });
                }

                function checkoutPR(prNumber) {
                    vscode.postMessage({ type: 'checkoutPR', prNumber });
                }

                function openCreateIssueModal() {
                    document.getElementById('create-issue-modal').style.display = 'block';
                    document.getElementById('issue-title').focus();
                    // Load collaborators when opening the modal
                    vscode.postMessage({ type: 'loadCollaborators' });
                }

                function closeCreateIssueModal() {
                    document.getElementById('create-issue-modal').style.display = 'none';
                    document.getElementById('create-issue-form').reset();
                }

                function loadLocal() {
                    document.getElementById('stashes-list').innerHTML = '<div class="loading">Loading stashes...</div>';
                    document.getElementById('changes-list').innerHTML = '<div class="loading">Loading changes...</div>';
                    vscode.postMessage({ type: 'loadLocal' });
                }

                function loadActivity() {
                    document.getElementById('activity-list').innerHTML = '<div class="loading">Loading recent activity...</div>';
                    vscode.postMessage({ type: 'loadActivity' });
                }

                function checkoutPRGitHub(prNumber) {
                    vscode.postMessage({ type: 'checkoutPRGitHub', prNumber });
                }

                function createIssue(event) {
                    event.preventDefault();
                    
                    const title = document.getElementById('issue-title').value.trim();
                    const body = document.getElementById('issue-body').value.trim();
                    const labelsInput = document.getElementById('issue-labels').value.trim();
                    const assigneeSelect = document.getElementById('issue-assignees');
                    
                    if (!title) {
                        alert('Issue title is required');
                        return;
                    }
                    
                    const labels = labelsInput ? labelsInput.split(',').map(l => l.trim()).filter(l => l) : [];
                    const assignees = Array.from(assigneeSelect.selectedOptions)
                        .map(option => option.value)
                        .filter(value => value && value !== '');
                    
                    vscode.postMessage({ 
                        type: 'createIssue', 
                        title: title,
                        body: body || undefined,
                        labels: labels.length > 0 ? labels : undefined,
                        assignees: assignees.length > 0 ? assignees : undefined
                    });
                    
                    closeCreateIssueModal();
                }

                let currentCheckoutIssue = null;
                let suggestedBranchName = null;

                function openCheckoutDialog(issueNumber, defaultBranchName) {
                    currentCheckoutIssue = issueNumber;
                    suggestedBranchName = defaultBranchName;
                    
                    document.getElementById('checkout-issue-number').textContent = '#' + issueNumber;
                    document.getElementById('branch-name').value = defaultBranchName;
                    document.getElementById('checkout-dialog').style.display = 'block';
                    document.getElementById('branch-name').focus();
                    document.getElementById('branch-name').select();
                }

                function closeCheckoutDialog() {
                    document.getElementById('checkout-dialog').style.display = 'none';
                    currentCheckoutIssue = null;
                    suggestedBranchName = null;
                }

                function confirmCheckout() {
                    if (!currentCheckoutIssue) return;
                    
                    const branchName = document.getElementById('branch-name').value.trim();
                    if (!branchName) {
                        alert('Please enter a branch name');
                        return;
                    }
                    
                    // Validate branch name (basic validation)
                    if (!/^[a-zA-Z0-9_\-\/]+$/.test(branchName)) {
                        alert('Branch name contains invalid characters. Use only letters, numbers, hyphens, underscores, and forward slashes.');
                        return;
                    }
                    
                    vscode.postMessage({ 
                        type: 'checkoutIssueBranch', 
                        issueNumber: currentCheckoutIssue,
                        branchName: branchName
                    });
                    
                    closeCheckoutDialog();
                }

                function populateCollaborators(collaborators) {
                    const select = document.getElementById('issue-assignees');
                    select.innerHTML = '';
                    
                    if (collaborators.length === 0) {
                        select.innerHTML = '<option value="">No collaborators found</option>';
                        return;
                    }
                    
                    collaborators.forEach(collaborator => {
                        const option = document.createElement('option');
                        option.value = collaborator.login;
                        option.textContent = collaborator.login + ' (' + collaborator.type + ')';
                        select.appendChild(option);
                    });
                }

                function renderItems(items, containerId, type) {
                    const container = document.getElementById(containerId);
                    if (items.length === 0) {
                        container.innerHTML = '<div class="loading">No ' + type + ' found</div>';
                        return;
                    }

                    container.innerHTML = items.map(item => {
                        const labels = item.labels ? item.labels.map(label => 
                            '<span class="label">' + label.name + '</span>'
                        ).join('') : '';

                        // Determine priority class based on labels
                        let priorityClass = '';
                        if (item.labels) {
                            const priorityLabel = item.labels.find(label => 
                                ['priority: high', 'high priority', 'urgent', 'critical'].includes(label.name.toLowerCase()) ||
                                label.name.toLowerCase().includes('high')
                            );
                            if (priorityLabel) {
                                priorityClass = 'priority-high';
                            } else {
                                const mediumLabel = item.labels.find(label => 
                                    ['priority: medium', 'medium priority', 'normal'].includes(label.name.toLowerCase()) ||
                                    label.name.toLowerCase().includes('medium')
                                );
                                if (mediumLabel) {
                                    priorityClass = 'priority-medium';
                                } else {
                                    const lowLabel = item.labels.find(label => 
                                        ['priority: low', 'low priority', 'minor'].includes(label.name.toLowerCase()) ||
                                        label.name.toLowerCase().includes('low')
                                    );
                                    if (lowLabel) {
                                        priorityClass = 'priority-low';
                                    }
                                }
                            }
                        }

                        let actions = '';
                        if (type === 'pull requests') {
                            actions = '<div class="checkout-buttons">' +
                                '<button class="action-btn" onclick="checkoutPR(' + item.number + ')">Checkout</button>' +
                                '<button class="github-checkout-btn" onclick="checkoutPRGitHub(' + item.number + ')">GitHub Style</button>' +
                            '</div>';
                        } else if (type === 'issues') {
                            actions = '<div class="issue-actions">' +
                                '<button class="action-btn" onclick="openCheckoutDialog(' + item.number + ', \'issue-' + item.number + '\')">Checkout Branch</button>' +
                            '</div>';
                        }

                        const preview = item.body_preview ? '<div class="item-preview">' + item.body_preview + '</div>' : '';
                        
                        return '<div class="item ' + priorityClass + '" onclick="viewDetails(' + JSON.stringify({...item, type: type === 'issues' ? 'issue' : 'pr'}).replace(/"/g, '&quot;') + ')">' +
                            '<div class="item-title">#' + item.number + ' ' + item.title + '</div>' +
                            '<div class="author-info">' +
                                '<img class="author-avatar" src="' + item.user.avatar_url + '" alt="' + item.user.login + '" onerror="this.style.display=\'none\'">' +
                                '<span>by ' + item.user.login + '</span>' +
                            '</div>' +
                            '<div class="item-meta">' +
                                new Date(item.created_at).toLocaleDateString() + ' • ' +
                                item.state +
                            '</div>' +
                            preview +
                            '<div class="item-labels">' + labels + '</div>' +
                            '<div class="actions">' + actions + '</div>' +
                        '</div>';
                    }).join('');
                }

                function updateUserInfo(user) {
                    if (user) {
                        document.getElementById('user-avatar').src = user.avatar_url;
                        document.getElementById('user-name').textContent = user.login;
                        document.getElementById('user-info').style.display = 'flex';
                    }
                }

                function updateRepoStats(stats, repository) {
                    if (stats) {
                        document.getElementById('repo-title').textContent = repository || 'GitHub Dev Dashboard';
                        document.getElementById('stars').textContent = stats.stars;
                        document.getElementById('forks').textContent = stats.forks;
                        document.getElementById('watchers').textContent = stats.watchers;
                        document.getElementById('open-issues').textContent = stats.openIssues;
                        document.getElementById('repo-stats').style.display = 'flex';
                    }
                }

                function renderLocalData(stashes, changes) {
                    // Render stashes
                    const stashesContainer = document.getElementById('stashes-list');
                    if (stashes.length === 0) {
                        stashesContainer.innerHTML = '<div style="color: var(--vscode-descriptionForeground);">No stashes found</div>';
                    } else {
                        stashesContainer.innerHTML = stashes.map(stash => 
                            '<div style="margin-bottom: 4px; font-family: monospace;">' + stash + '</div>'
                        ).join('');
                    }

                    // Render changes
                    const changesContainer = document.getElementById('changes-list');
                    const allFiles = [
                        ...changes.staged.map(file => ({ file, status: 'A', statusClass: 'staged' })),
                        ...changes.modified.map(file => ({ file, status: 'M', statusClass: 'modified' })),
                        ...changes.untracked.map(file => ({ file, status: '?', statusClass: 'untracked' }))
                    ];

                    if (allFiles.length === 0) {
                        changesContainer.innerHTML = '<div style="color: var(--vscode-descriptionForeground);">No uncommitted changes</div>';
                    } else {
                        changesContainer.innerHTML = allFiles.map(item => 
                            '<div class="file-item">' +
                                '<span class="file-status ' + item.statusClass + '">' + item.status + '</span>' +
                                '<span>' + item.file + '</span>' +
                            '</div>'
                        ).join('');
                    }
                }

                function renderActivity(activities) {
                    const container = document.getElementById('activity-list');
                    if (activities.length === 0) {
                        container.innerHTML = '<div style="color: var(--vscode-descriptionForeground); text-align: center; padding: 20px;">No recent activity found</div>';
                        return;
                    }

                    container.innerHTML = activities.map(activity => {
                        const time = new Date(activity.created_at).toLocaleDateString() + ' ' + new Date(activity.created_at).toLocaleTimeString();
                        let icon = '📝';
                        let content = '';
                        let actor = '';

                        if (activity.type === 'commit') {
                            icon = '💾';
                            actor = activity.author?.login || 'Unknown';
                            content = activity.message.split('\\n')[0]; // First line only
                            return '<div class="activity-item">' +
                                '<div class="activity-header">' +
                                    '<span class="activity-icon">' + icon + '</span>' +
                                    '<span class="activity-actor">' + actor + '</span>' +
                                    '<span>committed</span>' +
                                    '<span class="activity-time">' + time + '</span>' +
                                '</div>' +
                                '<div class="activity-content">' + content + '</div>' +
                                '<div class="activity-commit">' + activity.sha.substring(0, 7) + '</div>' +
                            '</div>';
                        } else {
                            actor = activity.actor?.login || 'Unknown';
                            
                            switch (activity.eventType) {
                                case 'PushEvent':
                                    icon = '⬆️';
                                    content = 'pushed ' + (activity.payload.commits?.length || 0) + ' commit(s)';
                                    break;
                                case 'IssuesEvent':
                                    icon = '🐛';
                                    content = activity.payload.action + ' issue #' + activity.payload.issue?.number;
                                    break;
                                case 'PullRequestEvent':
                                    icon = '📥';
                                    content = activity.payload.action + ' pull request #' + activity.payload.pull_request?.number;
                                    break;
                                case 'CreateEvent':
                                    icon = '🆕';
                                    content = 'created ' + activity.payload.ref_type + (activity.payload.ref ? ' ' + activity.payload.ref : '');
                                    break;
                                case 'WatchEvent':
                                    icon = '⭐';
                                    content = 'starred the repository';
                                    break;
                                default:
                                    content = activity.eventType.replace('Event', '');
                            }

                            return '<div class="activity-item">' +
                                '<div class="activity-header">' +
                                    '<span class="activity-icon">' + icon + '</span>' +
                                    '<span class="activity-actor">' + actor + '</span>' +
                                    '<span class="activity-time">' + time + '</span>' +
                                '</div>' +
                                '<div class="activity-content">' + content + '</div>' +
                            '</div>';
                        }
                    }).join('');
                }

                function filterItems(items, searchTerm, statusFilter, type) {
                    return items.filter(item => {
                        const matchesSearch = !searchTerm || 
                            item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            item.user.login.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (item.labels && item.labels.some(label => label.name.toLowerCase().includes(searchTerm.toLowerCase())));
                        
                        const matchesStatus = !statusFilter || item.state === statusFilter;
                        
                        return matchesSearch && matchesStatus;
                    });
                }

                function applyIssuesFilter() {
                    const searchTerm = document.getElementById('issues-search').value;
                    const statusFilter = document.getElementById('issues-status-filter').value;
                    const filteredIssues = filterItems(currentData.issues || [], searchTerm, statusFilter, 'issues');
                    renderItems(filteredIssues, 'issues-grid', 'issues');
                }

                function applyPRsFilter() {
                    const searchTerm = document.getElementById('prs-search').value;
                    const statusFilter = document.getElementById('prs-status-filter').value;
                    const filteredPRs = filterItems(currentData.prs || [], searchTerm, statusFilter, 'pull requests');
                    renderItems(filteredPRs, 'prs-grid', 'pull requests');
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'dataLoaded') {
                        currentData = message;
                        renderItems(message.issues, 'issues-grid', 'issues');
                        renderItems(message.prs, 'prs-grid', 'pull requests');
                        if (message.user) {
                            updateUserInfo(message.user);
                        }
                        if (message.stats) {
                            updateRepoStats(message.stats, message.repository);
                        }
                        hideAccessDenied();
                    } else if (message.type === 'issuesRefreshed') {
                        currentData.issues = message.issues;
                        renderItems(message.issues, 'issues-grid', 'issues');
                    } else if (message.type === 'prsRefreshed') {
                        currentData.prs = message.prs;
                        renderItems(message.prs, 'prs-grid', 'pull requests');
                    } else if (message.type === 'localDataLoaded') {
                        renderLocalData(message.stashes, message.changes);
                    } else if (message.type === 'activityLoaded') {
                        renderActivity(message.activity);
                    } else if (message.type === 'prDetailsLoaded') {
                        // Handle PR details loaded in detail view
                        console.log('PR details loaded:', message.prDetails);
                    } else if (message.type === 'prCommentsLoaded') {
                        // Handle PR comments loaded in detail view
                        console.log('PR comments loaded:', message.comments);
                    } else if (message.type === 'prCommentAdded') {
                        // Handle new PR comment added
                        console.log('PR comment added:', message.comment);
                    } else if (message.type === 'accessDenied') {
                        if (message.user) {
                            updateUserInfo(message.user);
                        }
                        showAccessDenied(message.repository, message.user?.login || 'Unknown');
                    } else if (message.type === 'authenticationError') {
                        document.getElementById('issues-grid').innerHTML = '<div class="access-denied"><h3>🔐 Authentication Error</h3><p>' + message.message + '</p><button class="refresh-btn" onclick="switchAccount()">Switch Account</button></div>';
                        document.getElementById('prs-grid').innerHTML = '<div class="loading">Authentication required</div>';
                    } else if (message.type === 'collaboratorsLoaded') {
                        populateCollaborators(message.collaborators);
                    }
                });

                // Set up form submission
                document.getElementById('create-issue-form').addEventListener('submit', createIssue);
                
                // Close modals when clicking outside of them
                window.addEventListener('click', function(event) {
                    const issueModal = document.getElementById('create-issue-modal');
                    const checkoutModal = document.getElementById('checkout-dialog');
                    
                    if (event.target === issueModal) {
                        closeCreateIssueModal();
                    }
                    if (event.target === checkoutModal) {
                        closeCheckoutDialog();
                    }
                });

                // Set up search and filter event listeners
                document.getElementById('issues-search').addEventListener('input', applyIssuesFilter);
                document.getElementById('issues-status-filter').addEventListener('change', applyIssuesFilter);
                document.getElementById('prs-search').addEventListener('input', applyPRsFilter);
                document.getElementById('prs-status-filter').addEventListener('change', applyPRsFilter);

                loadData();
            </script>
        </body>
        </html>`;
    }

    private _getDetailsHtml(item: any) {
        const isPR = item.type === 'pr';
        
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${item.type === 'issue' ? 'Issue' : 'PR'} #${item.number}</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    line-height: 1.6;
                }
                .header {
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 16px;
                    margin-bottom: 20px;
                }
                .title {
                    font-size: 1.5em;
                    font-weight: bold;
                    margin-bottom: 8px;
                }
                .meta {
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 16px;
                }
                .labels {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 16px;
                }
                .label {
                    padding: 4px 8px;
                    border-radius: 12px;
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    font-size: 0.9em;
                }
                .body {
                    background-color: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    padding: 16px;
                    border-radius: 4px;
                    margin-bottom: 20px;
                }
                .body h1, .body h2, .body h3 { color: var(--vscode-textLink-foreground); }
                .body code { 
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-family: var(--vscode-editor-font-family);
                }
                .body pre {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 12px;
                    border-radius: 4px;
                    overflow-x: auto;
                    font-family: var(--vscode-editor-font-family);
                }
                .actions {
                    margin-bottom: 20px;
                    display: flex;
                    gap: 8px;
                }
                .btn {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.9em;
                }
                .btn-primary {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .btn-primary:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .btn-secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                }
                .comments-section {
                    margin-top: 30px;
                }
                .comment {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    background-color: var(--vscode-editor-background);
                }
                .comment-header {
                    background-color: var(--vscode-panel-background);
                    padding: 8px 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                .comment-body {
                    padding: 12px;
                }
                .comment-type {
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 0.8em;
                    margin-left: 8px;
                }
                .add-comment {
                    margin-top: 20px;
                    padding: 16px;
                    background-color: var(--vscode-panel-background);
                    border-radius: 4px;
                    border: 1px solid var(--vscode-panel-border);
                }
                .comment-textarea {
                    width: 100%;
                    min-height: 100px;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-family: var(--vscode-font-family);
                    resize: vertical;
                    box-sizing: border-box;
                }
                .comment-textarea:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                .loading {
                    text-align: center;
                    color: var(--vscode-descriptionForeground);
                    padding: 20px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">#${item.number} ${item.title}</div>
                <div class="meta">
                    ${item.type === 'issue' ? 'Issue' : 'Pull Request'} by ${item.user.login} • 
                    Created ${new Date(item.created_at).toLocaleDateString()} • 
                    ${item.state}
                </div>
                <div class="labels">
                    ${item.labels ? item.labels.map((label: any) => `<span class="label">${label.name}</span>`).join('') : ''}
                </div>
            </div>

            ${isPR ? `
            <div class="actions">
                <button class="btn btn-primary" onclick="loadPRDetails()">Load Full Details</button>
                <button class="btn btn-secondary" onclick="copyPRContent()">📋 Copy PR + Comments</button>
                <button class="btn btn-secondary" onclick="loadComments()">💬 Load Comments</button>
            </div>` : ''}

            <div class="body" id="description-content">
                ${item.body || 'No description provided.'}
            </div>

            ${isPR ? `
            <div class="comments-section">
                <h3>Comments</h3>
                <div id="comments-container">
                    <div class="loading">Click "Load Comments" to view discussions</div>
                </div>
                
                <div class="add-comment">
                    <h4>Add Comment</h4>
                    <textarea id="new-comment" class="comment-textarea" placeholder="Write a comment... (Markdown supported)"></textarea>
                    <br><br>
                    <button class="btn btn-primary" onclick="addComment()">Add Comment</button>
                    <small style="color: var(--vscode-descriptionForeground); margin-left: 10px;">Supports Markdown formatting</small>
                </div>
            </div>` : ''}

            <script>
                const vscode = acquireVsCodeApi();
                let currentPR = ${isPR ? item.number : 'null'};
                let prDetails = null;
                let prComments = [];

                function loadPRDetails() {
                    if (!currentPR) return;
                    vscode.postMessage({ type: 'loadPRDetails', prNumber: currentPR });
                }

                function loadComments() {
                    if (!currentPR) return;
                    document.getElementById('comments-container').innerHTML = '<div class="loading">Loading comments...</div>';
                    vscode.postMessage({ type: 'loadPRComments', prNumber: currentPR });
                }

                function addComment() {
                    if (!currentPR) return;
                    const textarea = document.getElementById('new-comment');
                    const body = textarea.value.trim();
                    if (!body) {
                        alert('Please enter a comment');
                        return;
                    }
                    
                    vscode.postMessage({ 
                        type: 'addPRComment', 
                        prNumber: currentPR, 
                        body: body 
                    });
                    textarea.value = '';
                }

                function copyPRContent() {
                    if (!currentPR) return;
                    vscode.postMessage({ type: 'copyPRContent', prNumber: currentPR });
                }

                function renderComments(comments) {
                    const container = document.getElementById('comments-container');
                    if (comments.length === 0) {
                        container.innerHTML = '<div style="color: var(--vscode-descriptionForeground); text-align: center; padding: 20px;">No comments yet</div>';
                        return;
                    }

                    container.innerHTML = comments.map(comment => {
                        const time = new Date(comment.created_at).toLocaleString();
                        const typeLabel = comment.comment_type === 'review' ? '<span class="comment-type">Code Review</span>' : '';
                        return \`<div class="comment">
                            <div class="comment-header">
                                <strong>\${comment.user.login}</strong> commented \${time} \${typeLabel}
                            </div>
                            <div class="comment-body">\${comment.body_html}</div>
                        </div>\`;
                    }).join('');
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'prDetailsLoaded') {
                        prDetails = message.prDetails;
                        document.getElementById('description-content').innerHTML = prDetails.body_html || 'No description provided.';
                    } else if (message.type === 'prCommentsLoaded') {
                        prComments = message.comments;
                        renderComments(message.comments);
                    } else if (message.type === 'prCommentAdded') {
                        prComments.push(message.comment);
                        renderComments(prComments);
                    }
                });
            </script>
        </body>
        </html>`;
    }
}