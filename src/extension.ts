import * as vscode from 'vscode';
import { devDashProvider } from './devDashProvider';
import { debugChannel } from './debugChannel';

class GitHubDashboardProvider implements vscode.TreeDataProvider<string> {

    getTreeItem(element: string): vscode.TreeItem {
        const item = new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.None);
        item.command = {
            command: 'devDash.openViewer',
            title: 'Open Dashboard',
            arguments: []
        };
        item.iconPath = new vscode.ThemeIcon('github');
        return item;
    }

    getChildren(element?: string): string[] {
        if (!element) {
            return ['Open GitHub Dashboard'];
        }
        return [];
    }
}

export function activate(context: vscode.ExtensionContext) {
    debugChannel.info('Extension activating...');
    
    // Register tree data provider for sidebar
    const treeDataProvider = new GitHubDashboardProvider();
    const treeDataProviderDisposable = vscode.window.registerTreeDataProvider('devDashboard', treeDataProvider);
    
    const openViewerDisposable = vscode.commands.registerCommand('devDash.openViewer', () => {
        debugChannel.log('Opening GitHub Viewer');
        devDashProvider.createOrShow(context.extensionUri);
    });

    const showDebugDisposable = vscode.commands.registerCommand('devDash.showDebugChannel', () => {
        debugChannel.show();
    });

    const refreshDisposable = vscode.commands.registerCommand('devDash.refresh', () => {
        debugChannel.log('Refreshing GitHub Dashboard');
        devDashProvider.createOrShow(context.extensionUri);
    });

    context.subscriptions.push(
        treeDataProviderDisposable,
        openViewerDisposable, 
        showDebugDisposable, 
        refreshDisposable,
        debugChannel
    );
    
    debugChannel.info('Extension activated successfully');
}

export function deactivate() {
    debugChannel.info('Extension deactivating...');
}