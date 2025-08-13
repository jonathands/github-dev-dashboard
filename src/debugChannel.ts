import * as vscode from 'vscode';

export class DebugChannel {
    private static instance: DebugChannel;
    private outputChannel: vscode.OutputChannel;
    private isDebugEnabled: boolean = false;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('GitHub Issues & PRs Debug');
        this.updateDebugSetting();
        
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('devDash.debug')) {
                this.updateDebugSetting();
            }
        });
    }

    public static getInstance(): DebugChannel {
        if (!DebugChannel.instance) {
            DebugChannel.instance = new DebugChannel();
        }
        return DebugChannel.instance;
    }

    private updateDebugSetting(): void {
        this.isDebugEnabled = vscode.workspace.getConfiguration('devDash').get('debug', false);
    }

    public log(message: string, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] ${message}`;
        
        if (this.isDebugEnabled) {
            this.outputChannel.appendLine(formattedMessage);
            if (args.length > 0) {
                this.outputChannel.appendLine(`Arguments: ${JSON.stringify(args, null, 2)}`);
            }
        }
        
        console.log(formattedMessage, ...args);
    }

    public error(message: string, error?: Error): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] ERROR: ${message}`;
        
        this.outputChannel.appendLine(formattedMessage);
        if (error) {
            this.outputChannel.appendLine(`Error details: ${error.message}`);
            this.outputChannel.appendLine(`Stack trace: ${error.stack}`);
        }
        
        console.error(formattedMessage, error);
    }

    public warn(message: string, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] WARN: ${message}`;
        
        if (this.isDebugEnabled) {
            this.outputChannel.appendLine(formattedMessage);
            if (args.length > 0) {
                this.outputChannel.appendLine(`Arguments: ${JSON.stringify(args, null, 2)}`);
            }
        }
        
        console.warn(formattedMessage, ...args);
    }

    public info(message: string, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] INFO: ${message}`;
        
        if (this.isDebugEnabled) {
            this.outputChannel.appendLine(formattedMessage);
            if (args.length > 0) {
                this.outputChannel.appendLine(`Arguments: ${JSON.stringify(args, null, 2)}`);
            }
        }
        
        console.info(formattedMessage, ...args);
    }

    public show(): void {
        this.outputChannel.show();
    }

    public clear(): void {
        this.outputChannel.clear();
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}

export const debugChannel = DebugChannel.getInstance();