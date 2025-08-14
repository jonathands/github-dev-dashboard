# GitHub Dev Dashboard for VS Code

A comprehensive GitHub repository management dashboard that brings GitHub Issues, Pull Requests, and repository insights directly into VS Code.

![GitHub Dev Dashboard](https://img.shields.io/badge/VS%20Code-Extension-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-0.0.1-orange)

> **Notice**: This is an independent extension not affiliated with GitHub. GitHub offers excellent official extensions for issues and actions management.

## ✨ Completed Features

- ✅ **Support Account Switching**: Multi-user GitHub account management
- ✅ **List Repos Existing Stashes**: View all git stashes
- ✅ **View Unpushed Local Commit Changes**: Monitor uncommitted files
- ✅ **Easy Issue Creation**: Create GitHub issues from extension UI
- ✅ **Support MD on Descriptions**: Full GitHub-flavored markdown rendering
- ✅ **Comments and Answers on PRs**: Complete PR discussion system
- ✅ **Copy Descriptions and Comment Threads**: Export PR content as markdown
- ✅ **GitHub Style PR Branches**: Enhanced PR checkout with GitHub CLI conventions
- ✅ **Filtering for Issues and PRs**: Search by name, author, status
- ✅ **Show Stars, Forks, Watchers**: Repository statistics display
- ✅ **Show Recent Activity**: Timeline of repository events and commits
- ✅ **Documentation Tab**: In-app feature documentation

## 🚧 Future Roadmap

- [ ] **PR Branch Detection**: See if PR branches exist locally or remotely
- [ ] **PR Actions**: Approval, merging, and rejection capabilities
- [ ] **GitHub Actions Integration**: View and run workflows
- [ ] **Repository Alias Resolution**: Improve remote detection
- [ ] **Marketplace Publishing**: Official VS Code extension store
- [ ] **File Path Utilities**: Copy open tabs and source control paths
- [ ] **Wakatime Integration**: Development time tracking
## Features

- 📋 **Grid View**: Display issues and PRs in a responsive grid layout in the main window
- 🔍 **Details View**: Click any item to view detailed information in a separate pane
- 🔄 **Checkout PRs**: Easily checkout pull requests with one click
- 🎯 **GitHub Icon**: Click the GitHub icon in the editor title bar to open the viewer
- 🔐 **VS Code GitHub Auth**: Uses your existing VS Code GitHub authentication
- ⚡ **Real-time Data**: Fetches live data from GitHub API
- **Multi User Support** : Support switching users

## Setup & Usage

### Prerequisites
- VS Code 1.74.0 or higher
- Git repository with GitHub remote
- GitHub account signed in to VS Code

### Installation
1. Clone or download this extension
2. Open the extension folder in VS Code
3. Press `F5` to launch the Extension Development Host
4. In the new VS Code window, open any Git repository with GitHub remote

### How to Use
1. **Open you repo** 
2. **Click the GitHub icon** (📱) in the editor title bar
3. **Sign in to GitHub** when prompted (if not already authenticated)
4. **Browse issues and PRs** in the grid layout
5. **Click items** to view details or **checkout PRs**

## Commands

- `GitHub Issues & PRs`: Opens the main viewer (available in Command Palette)

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Run extension
Press F5 in VS Code or use Run > Start Debugging

# Build VSIX
vsce package
```


## Authentication

The extension automatically uses VS Code's built-in GitHub authentication. No separate token configuration is required - it will prompt you to sign in when needed.
If you have multiple accounts, the current logged account will show up in th top right, and you can switch accordingly yo your needs

## Requirements

- Git repository with GitHub remote (origin)
- VS Code GitHub authentication

## License
MIT