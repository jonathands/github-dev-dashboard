# GitHub Dev Dashboard

Objective:

Build a VSCode github dashboard with the ability to manager mostly Issues and PRs, and facilitate some coding agent tasks

#### Notice: I'm not affiliated with github, they have a great extension to manage issues, and another for actions


# TODOs
- [x] Support Account Switching
- [ ] List Repos existing stashes
- [ ] View unpushed local commit changes
- [ ] Allow for Easy creation of Issues from this Extensions UI
- [ ] Support MD on descriptions
- [ ] Allow for Comments and answers on PRs
- [ ] Allow copying of descriptions and comment threads as a single entitly
- [ ] Allow checkout in github style PR branches
- [ ] Add filtering for Issues and PRs:  search by name, owner and status
- [ ] Allow the user to automatically see if a PR branch for the  Issue exists locally or remotely
- [ ] Allow PR Approval, Merging and Rejection
- [ ] Show Stars, forks, watchers 
- [ ] Show recent activity.
- [ ] View and run github actions
- [ ] Fix workaround I made when resolving repo/owner from alias
- [ ] Publish to Extension Archive
- [ ] Add command to copy all open tabs absolute OR relative paths
- [ ] Add command to copy the paths of all files in the Source Control Window
- [ ] Add a tab with documentation of the dashboards features
- [ ] Wakatime integration ?
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