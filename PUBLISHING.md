# Publishing Glazed Bedrock to GitHub

## Before every upload: keep your personal data out

These must **never** be uploaded. `.gitignore` already keeps them out:

| File | Why it's private |
|---|---|
| `auth/` | Your Microsoft/Xbox login tokens. Anyone with them can join servers as you |
| `config.json` | Your settings: webhook URLs, Discord ID, friends' names |
| `proxy-debug.log` | Your gamertag and Xbox ID |

Check what's about to be uploaded with `git status`. If any of those files show up, stop and don't commit.

## First time: create the repository and push

1. Go to <https://github.com/new> and sign in.
2. **Repository name:** `Glazed-For-Bedrock`. **Public** if you want people to read the code and trust it.
3. Leave "Add a README", ".gitignore" and "license" **unticked** (the project already has them), then click **Create repository**.
4. In this folder, open a terminal (in File Explorer, click the address bar, type `cmd`, press Enter) and run:

   ```
   git remote add origin https://github.com/silent-arcade/Glazed-For-Bedrock.git
   git push -u origin main
   ```

   A browser window opens the first time and asks you to sign in to GitHub. That's Git's own login; approve it.

## Share a download for your friends

1. Build the zip: `npm run pack`. It writes `dist/glazed-bedrock.zip` and refuses to build if a private file would end up inside.
2. On your repository page: **Releases → Create a new release**. Use tag `v0.1.0`, give it a title, and drag in `dist/glazed-bedrock.zip`. Then click **Publish release**.
3. Send friends the release link. They install [Node.js](https://nodejs.org), unzip, and double-click `start.bat`.

## Uploading changes later

```
git add src tools test README.md start.bat package.json package-lock.json
git commit -m "Describe what changed"
git push
```

For a new download, run `npm run pack` again and make a new release (`v0.1.1`, `v0.2.0`, …).

## If a token ever got uploaded

Deleting the file afterwards isn't enough, because it stays in the history. Do these:
- **Revoke it:** sign out of all devices at <https://account.microsoft.com/security>. That makes the uploaded token useless.
- **Remove it:** delete the `auth` folder, then make the repository private, or delete and re-create it.
