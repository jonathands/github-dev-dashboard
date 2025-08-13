import * as vscode from 'vscode';
import { devDashProvider } from './devDashProvider';
import { debugChannel } from './debugChannel';

export function activate(context: vscode.ExtensionContext) {
    debugChannel.info('Extension activating...');
    
    const openViewerDisposable = vscode.commands.registerCommand('devDash.openViewer', () => {
        debugChannel.log('Opening GitHub Viewer');
        devDashProvider.createOrShow(context.extensionUri);
    });

    const showDebugDisposable = vscode.commands.registerCommand('devDash.showDebugChannel', () => {
        debugChannel.show();
    });

    context.subscriptions.push(openViewerDisposable, showDebugDisposable);
    context.subscriptions.push(debugChannel);
    
    debugChannel.info('Extension activated successfully');
}

export function deactivate() {
    debugChannel.info('Extension deactivating...');
}