# GitHub Dev Dashboard Extension - Claude Documentation

## Project Overview
This is a VS Code extension that provides a comprehensive GitHub repository management dashboard directly within the VS Code editor. The extension integrates with GitHub's API to display issues, pull requests, repository statistics, and local git operations.

## Key Features

### ✨ Current Features
- **Issues Management**: View and create GitHub issues with full permission checking
- **Issues Filtering**: Real-time search by title, author, labels, and status filtering
- **Pull Requests**: Browse PRs and checkout branches locally with dual checkout options
- **GitHub-style Checkout**: Enhanced PR checkout using GitHub CLI naming conventions
- **Markdown Support**: Full GitHub-flavored markdown rendering for descriptions and comments
- **PR Comments System**: View, add, and manage PR discussion threads and code reviews
- **Copy PR Content**: One-click copy of entire PR with comments as structured markdown
- **Repository Statistics**: Display stars, forks, watchers, and open issues count
- **Recent Activity Feed**: Timeline of repository events, commits, and activities
- **Local Git Operations**: Monitor git stashes and uncommitted file changes
- **Account Management**: Switch between different GitHub accounts
- **Permission-based UI**: Smart interface that adapts based on user's repository access
- **Advanced Filtering**: Search and filter Issues and PRs by multiple criteria

### 📁 File Structure
```
src/
├── extension.ts           # Extension entry point and command registration
├── devDashProvider.ts     # Main webview provider with UI and message handling
├── githubService.ts       # GitHub API integration and local git operations
└── debugChannel.ts        # Logging and debugging utilities
```

### 🔧 Technical Architecture

#### Core Services
1. **GitHubService** (`src/githubService.ts`)
   - GitHub API authentication and operations
   - Repository statistics fetching
   - Issue creation and management
   - Local git operations (stashes, uncommitted changes)
   - PR checkout functionality

2. **devDashProvider** (`src/devDashProvider.ts`)
   - Webview panel management
   - Message handling between webview and extension
   - HTML/CSS/JavaScript generation for the UI
   - Data loading and permission management

#### User Interface Tabs
- **Issues Tab**: List, create, search, and filter GitHub issues
- **Pull Requests Tab**: Browse, search, filter, and checkout PRs with dual checkout modes
- **Activity Tab**: View recent repository activity timeline with events and commits
- **Local Tab**: View git stashes and uncommitted changes
- **Documentation Tab**: In-app help and feature documentation

### 🛠 Development Guidelines

#### When Adding New Features:
1. **GitHubService Updates**: Add new API methods or git operations in `githubService.ts`
2. **Message Handlers**: Add corresponding message types in `devDashProvider._handleMessage()`
3. **UI Updates**: Update the HTML template in `_getHtmlForWebview()` method
4. **JavaScript Functions**: Add client-side logic for new interactions
5. **CSS Styling**: Maintain VS Code theme consistency using CSS variables

#### Permission Handling:
- Always check repository access using `checkRepositoryAccess()` before write operations
- Display appropriate UI elements based on user permissions
- Handle authentication errors gracefully with account switching options

#### Error Handling:
- Use `debugChannel` for logging all operations
- Show user-friendly error messages via `vscode.window.showErrorMessage()`
- Implement fallback UI states for failed operations

### 📝 Documentation Maintenance

**IMPORTANT**: When updating this extension's features, always:

1. **Update Documentation Tab**: Modify the docs content in `devDashProvider.ts` around lines 735-773
2. **Update This File**: Keep `CLAUDE.md` current with any architectural changes
3. **Update README.md**: Ensure user-facing documentation reflects new capabilities
4. **Test All Features**: Verify existing functionality still works after changes

### 🧪 Testing Checklist

Before finalizing updates:
- [ ] Test GitHub authentication flow
- [ ] Verify issue creation with various permission levels
- [ ] Check PR checkout functionality
- [ ] Validate local git operations
- [ ] Test account switching
- [ ] Ensure UI responsiveness across all tabs
- [ ] Verify error handling for network issues
- [ ] Test with repositories having different access levels

### 🔒 Security Considerations
- Never commit or log authentication tokens
- Validate all user inputs before sending to GitHub API
- Handle rate limiting appropriately
- Respect repository permissions for all operations

### 📊 Current Status
- ✅ Advanced GitHub integration with activity feeds
- ✅ Issue management with creation and filtering
- ✅ PR browsing with dual checkout modes (standard + GitHub CLI style)
- ✅ Full GitHub-flavored markdown rendering support
- ✅ Complete PR comments and discussion system
- ✅ One-click copy of PR content with comments
- ✅ Real-time search and filtering for Issues and PRs
- ✅ Repository statistics display with activity timeline
- ✅ Local git operations monitoring
- ✅ Multi-account support
- ✅ Permission-based UI
- ✅ Comprehensive documentation
- ✅ Advanced filtering by title, author, labels, and status
- ✅ Recent activity feed with events and commits
- ✅ Sidebar integration with GitHub icon
- ✅ Command palette and menu integration
- ✅ Optimized package size and dependencies

### 🔧 Installation & Usage
- **Sidebar Access**: Look for "GitHub Dev Dashboard" in the Explorer sidebar
- **Command Palette**: Use `Ctrl+Shift+P` → "Open GitHub Dev Dashboard"
- **Editor Title**: Click the GitHub icon in any editor tab
- **View Menu**: Access through VS Code's View menu

This extension provides a complete GitHub workflow integration for VS Code users, with markdown support, comment management, advanced filtering, activity monitoring, enhanced PR checkout options, proper error handling, security measures, sidebar integration, and extensible architecture for future enhancements.