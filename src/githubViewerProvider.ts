import * as vscode from 'vscode';
import { GitHubService } from './githubService';
import { debugChannel } from './debugChannel';

export class GitHubViewerProvider {
    public static readonly viewType = 'githubViewer.view';
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

        if (GitHubViewerProvider._currentPanel) {
            debugChannel.log('Revealing existing panel');
            GitHubViewerProvider._currentPanel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            GitHubViewerProvider.viewType,
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

        GitHubViewerProvider._currentPanel = panel;
        const provider = new GitHubViewerProvider(extensionUri);
        provider._update(panel.webview, extensionUri);
        debugChannel.info('GitHub Viewer panel created successfully');

        panel.onDidDispose(() => {
            debugChannel.log('GitHub Viewer panel disposed');
            GitHubViewerProvider._currentPanel = undefined;
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

            const [user, issues, prs] = await Promise.all([
                this.githubService.getCurrentUser(),
                this.githubService.getIssues(repoInfo.owner, repoInfo.repo),
                this.githubService.getPullRequests(repoInfo.owner, repoInfo.repo)
            ]);

            this._sendMessage({
                type: 'dataLoaded',
                user,
                issues,
                prs
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

    private _sendMessage(message: any) {
        if (GitHubViewerProvider._currentPanel) {
            GitHubViewerProvider._currentPanel.webview.postMessage(message);
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
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h2>GitHub Issues & Pull Requests</h2>
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
                <button class="tab" onclick="showTab('prs')">Pull Requests</button>
                <button class="tab-refresh" onclick="refreshPRs()">↻</button>
            </div>
            
            <div id="issues-tab" class="tab-content">
                <div id="issues-grid" class="grid">
                    <div class="loading">Loading issues...</div>
                </div>
            </div>
            
            <div id="prs-tab" class="tab-content" style="display: none;">
                <div id="prs-grid" class="grid">
                    <div class="loading">Loading pull requests...</div>
                </div>
            </div>

            <div id="access-denied" class="access-denied" style="display: none;">
                <h3>⚠️ Access Denied</h3>
                <p>You don't have access to this repository with the current GitHub account.</p>
                <p><strong>Repository:</strong> <span id="denied-repo"></span></p>
                <p><strong>Current User:</strong> <span id="denied-user"></span></p>
                <button class="refresh-btn" onclick="switchAccount()">Switch GitHub Account</button>
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

                        const actions = type === 'pull requests' ? 
                            '<button class="action-btn" onclick="checkoutPR(' + item.number + ')">Checkout</button>' : '';

                        return '<div class="item" onclick="viewDetails(' + JSON.stringify({...item, type: type === 'issues' ? 'issue' : 'pr'}).replace(/"/g, '&quot;') + ')">' +
                            '<div class="item-title">#' + item.number + ' ' + item.title + '</div>' +
                            '<div class="item-meta">' +
                                'by ' + item.user.login + ' • ' + 
                                new Date(item.created_at).toLocaleDateString() + ' • ' +
                                item.state +
                            '</div>' +
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

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'dataLoaded') {
                        currentData = message;
                        renderItems(message.issues, 'issues-grid', 'issues');
                        renderItems(message.prs, 'prs-grid', 'pull requests');
                        if (message.user) {
                            updateUserInfo(message.user);
                        }
                        hideAccessDenied();
                    } else if (message.type === 'issuesRefreshed') {
                        currentData.issues = message.issues;
                        renderItems(message.issues, 'issues-grid', 'issues');
                    } else if (message.type === 'prsRefreshed') {
                        currentData.prs = message.prs;
                        renderItems(message.prs, 'prs-grid', 'pull requests');
                    } else if (message.type === 'accessDenied') {
                        if (message.user) {
                            updateUserInfo(message.user);
                        }
                        showAccessDenied(message.repository, message.user?.login || 'Unknown');
                    } else if (message.type === 'authenticationError') {
                        document.getElementById('issues-grid').innerHTML = '<div class="access-denied"><h3>🔐 Authentication Error</h3><p>' + message.message + '</p><button class="refresh-btn" onclick="switchAccount()">Switch Account</button></div>';
                        document.getElementById('prs-grid').innerHTML = '<div class="loading">Authentication required</div>';
                    }
                });

                loadData();
            </script>
        </body>
        </html>`;
    }

    private _getDetailsHtml(item: any) {
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
                    white-space: pre-wrap;
                    background-color: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-textBlockQuote-border);
                    padding: 16px;
                    border-radius: 4px;
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
            <div class="body">
                ${item.body || 'No description provided.'}
            </div>
        </body>
        </html>`;
    }
}