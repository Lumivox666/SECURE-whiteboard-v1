# SECURE Parts Whiteboard

A self-hosted, phone-friendly pickup and delivery board for SECURE. Built from the team's whiteboard workflow. All **source files are at the repository root** — no nested app folders, build process, or external runtime dependencies.

## What it does

- **Two main lists:** Parts Pickups (green) and Parts Deliveries (orange/red), with a daily whiteboard and an interactive monthly calendar.
- **Click a date** to see what needs collecting or what should be delivered that day.
- **Track each vendor's parts** with expected date, vendor, unit/machine number, PO number, description, quantity and optional notes.
- **Click a unit or PO number** to display *all related entries and vendors*, including entries scheduled on other days. One machine may have parts coming from multiple vendors.
- **Mark Complete** when a pickup or delivery happens.
- **Reschedule missed items:** select Reschedule, enter a new expected date, and save the revised ETA. The update is noted automatically. Overdue entries are flagged.
- **Search** vendor, unit, PO and part descriptions across all dates.
- **Filter** by pickups/deliveries and scheduled/delayed/completed/overdue.
- **Export CSV** for a spreadsheet or download a full JSON backup.
- **TV board mode** for a shop monitor, with the sidebars hidden and bigger cards. The board automatically checks for updates every 20 seconds while visible.
- **Team access code** when configured in Railway. Shared server-side data for all users — not browser-only local storage.

The first launch contains **five SAMPLE entries dated November 6, 2026** matching the provided planning example. You can remove them with **Clear examples**; it does not remove any real entries you add. Branch locations are intentionally **not** a separate required field, per the latest request.

## Deploy to Railway (GitHub)

1. Create a **new GitHub repository** (for example, `secure-parts-whiteboard`). Upload the contents of this ZIP **directly into the repository root**, not inside an extra folder.
2. In [Railway](https://railway.com), choose **New Project → Deploy from GitHub repo**, then select your repository. Railway automatically recognizes `package.json`, uses Node.js and runs `npm start`.
3. In your Railway service **Variables**, add:

   | Name | Value | Purpose |
   | --- | --- | --- |
   | `SECURE_APP_PIN` | Your own private shared access code | Required for Railway login. Use a strong code and don't commit it to GitHub. |
   | `DATA_DIR` | `/data` | Writes persistent whiteboard entries to the attached Railway volume. |

4. In Railway, add a **persistent Volume** to this service, **mount path `/data`**. This matters: without a volume, Railway can discard local files when the service is redeployed or replaced. Set `DATA_DIR=/data` only if the volume is mounted. Add the volume **before adding real orders**.
5. Under **Settings → Networking**, generate a Railway public domain. Open it and enter the access code. Share this address only with the intended team.

**Critical:** this app uses an on-disk JSON database to keep setup simple. Railway's normal container filesystem is temporary. For real orders **use the volume**, or changes may be lost on redeploy. Back up with **Settings → Backup JSON** regularly. This is designed for a small team and a single Railway app instance; do not deploy multiple replicas against the same JSON file.

Railway deploys deliberately **require `SECURE_APP_PIN`**. Without it, the app shows a configuration-required screen rather than exposing your business orders to the public internet. The login uses an HTTP-only session cookie. This is shared-code access, not individualized accounts or an enterprise identity system.

## Run locally

Requires Node.js 20+.

```bash
npm start
```

Then open `http://localhost:3000` in your browser. For local testing, if no `SECURE_APP_PIN` is set, the app opens without a login. To try the secure login locally:

```bash
SECURE_APP_PIN=your-strong-code npm start
```

In Windows PowerShell:

```powershell
$env:SECURE_APP_PIN='your-strong-code'; npm start
```

Local entries are stored in `secure-data.json` next to `server.js` by default. This file is intentionally excluded from Git by `.gitignore`.

## Files (all at the root)

- `index.html` — the whiteboard interface
- `styles.css` — SECURE branding and mobile/desktop layout
- `app.js` — calendars, forms, reporting and interactions
- `server.js` — API, sessions and on-disk persistence (zero dependencies)
- `secure-logo.png` — logo provided, cropped transparently to suit the header
- `package.json` — Railway start command
- `railway.json` — Railway deployment and health check
- `.gitignore` — prevents accidental commits of actual data
- `README.md` — these instructions

## Workflow example

For a unit `LD167`, enter each vendor shipment or pickup as its **own entry**: e.g. Finning supplying edge/hooks due Friday, another vendor supplying a belt on Monday. Clicking **Unit LD167** shows both vendors and both expected dates. You can use the same PO on multiple entries; clicking that **PO** will show all those entries as well.

This app is a standalone schedule; it doesn't depend on access to a corporate calendar, inventory system or outside API. The examples are illustrative, not verified orders.

## Important limits

- This is an internal scheduling whiteboard; it does not automatically contact vendors, fetch shipping updates, or sync with external ERP/calendars.
- A shared PIN allows anyone with the PIN to add, edit, complete and delete entries. Use a nontrivial code and don't store sensitive account credentials in the notes.
- Export CSV is intended for working reports; JSON backup is the more complete archive.
