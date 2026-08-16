# Fork maintenance

This repository tracks the upstream Blackboard plugin through the `upstream` remote and publishes the customized fork through `origin`.

## Remotes

```bash
git fetch upstream
git log --oneline upstream/main..main
```

Review upstream changes before merging them into `main`. Keep user-facing changes in focused commits using Conventional Commit messages.

## Verification

Run the complete local gate before pushing:

```bash
npm ci
npm run check
```

The production build writes `main.js`, which is intentionally ignored by Git. Release assets are uploaded separately to GitHub Releases.

## Release

Update `manifest.json`, `package.json`, `versions.json`, and `CHANGELOG.md`, then run:

```bash
npm run check
git tag -a vX.Y.Z -m "Blackboard Plus X.Y.Z"
git push origin main --follow-tags
gh release create vX.Y.Z main.js manifest.json styles.css
```

Keep the MIT license, code of conduct, security policy, and contribution guide in every public release.
