
## Runtime Information

### Node.js Runtime
- **Current Runtime**: Node.js 24 (as of November 2025)
- **Previous Runtime**: Node.js 20 (deprecated, EOL April 2026)
- **GitHub Actions Support**: GitHub runner v2.328.0+ supports Node 24
- **Configuration**: Set in `action.yml` via `runs.using: 'node24'`

### Runtime Migration Notes
- Node 24 became available on GitHub-hosted runners in 2025
- GitHub will switch default from Node 20 to Node 24 on March 4, 2026
- All predictr-io actions migrated to Node 24 in November 2025
- No code changes required for Node 24 migration - only metadata update in action.yml

## Versioning and Release Strategy

### Version Tags
Each action maintains multiple tag formats:
- **Specific versions**: `v0.1.0`, `v0.1.1`, `v0.2.0` - Immutable, tied to specific releases
- **Major version tags**: `v0`, `v1` - Mutable, automatically updated to latest patch/minor within major version
- **Patch bumps**: Use for runtime updates, bug fixes, dependency updates with no breaking changes
- **Minor bumps**: Use for new features that are backward compatible
- **Major bumps**: Use for breaking changes (e.g., v0 → v1)

### Automated Release Workflow
`.github/workflows/release.yml` handles versioning automatically:
1. **Triggered by**: Pushing any version tag (e.g., `git push origin v0.1.2`)
2. **Verifies**: dist/ is built and committed
3. **Validates**: dist/ matches current source code
4. **Creates**: GitHub release with auto-generated release notes
5. **Updates**: Major version tag (v0 or v1) to point to new release
6. **Force-pushes**: Updated major version tag to GitHub

### Release Process for Developers
```bash
# Make changes to src/
npm run build              # Compile TypeScript to dist/
git add -A
git commit -m "Description of changes"
git push

# Create and push version tag
git tag v0.1.2            # Use appropriate semver
git push origin v0.1.2    # Workflow auto-updates v0 tag

# Workflow handles:
# - Creating GitHub release
# - Updating v0 → v0.1.2
# - Publishing release notes
```

### User Consumption
Users can reference actions in three ways:
- `uses: predictr-io/action-name@v0` - **Recommended**: Auto-updates to latest v0.x.x
- `uses: predictr-io/action-name@v0.1.2` - Pinned to specific version
- `uses: predictr-io/action-name@main` - Latest commit (not recommended for production)

## GitHub Marketplace Publishing

### Marketplace Metadata (in action.yml)
Required fields for marketplace:
- `name`: Action display name (clear, descriptive)
- `description`: Short description (under 125 characters)
- `author`: Author/organization name
- `branding.icon`: Feather icon name for marketplace display
- `branding.color`: Color theme (matches cloud provider: orange=AWS, blue=GCP)

### Publishing Process
1. **Initial publish**: Create first release, check "Publish to GitHub Marketplace"
2. **Select category**: Choose one primary category (Deployment, CI, Utilities, etc.)
3. **Automatic updates**: Future releases automatically update marketplace listing
4. **README sync**: Marketplace pulls README from main branch (always current)

### Marketplace Categories
GitHub Actions Marketplace categories (choose one):
- **Deployment** - Infrastructure management, resource creation/deletion
- **Continuous Integration** - Pipeline integration, message/metric sending
- **Utilities** - General-purpose tools, data transfer
- **Testing** - Test execution and validation
- (Other categories: API management, Chat, Code quality, Security, Monitoring, etc.)

### Discoverability Best Practices
- **Repository topics**: Add multiple tags (aws, gcp, messaging, ci-cd, testing, etc.)
- **Keywords in description**: Include relevant search terms
- **Comprehensive README**: Document multiple use cases and examples
- **Good branding**: Use meaningful icons and appropriate colors

### Branding Guidelines (predictr-io standard)
- **AWS actions**: `color: 'orange'` (AWS brand color)
- **GCP actions**: `color: 'blue'` (GCP brand color)
- **Create actions**: `icon: 'plus-square'` or `icon: 'plus-circle'`
- **Delete actions**: `icon: 'trash-2'`, `color: 'red'`, description includes "DESTRUCTIVE ACTION"
- **Send/publish actions**: `icon: 'send'`
- **Data actions**: `icon: 'database'`, `icon: 'search'`, `icon: 'activity'`

