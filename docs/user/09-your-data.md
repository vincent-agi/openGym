# 9. Your data

Gymme keeps your data under your control. This page explains where it lives and how to back it up, move it
or share part of it.

## Where is my data?

| How you use Gymme | Where your data is |
|---|---|
| **Signed in with a passkey** (web) | On the Gymme server, in your profile. Also cached in your browser. Synced between your devices. |
| **Guest mode** (web) | **Only in this browser.** Clearing the browser data deletes it. |
| **Android / iOS app** | **Only on your phone**, in the app's private storage. No server, no account. |
| **Live demo** | Only in your browser, on example data. |

Gymme has **no telemetry**: it does not track you or send usage data anywhere.

### Who can see my data?

- **The person who runs the server** can technically read everything stored there — treat them like you would
  any service provider. They are your friend or you, not a company, but trust matters.
- **An admin** (if the server has one) can see your workout history and body weight, and can disable accounts.
  That is the purpose of the admin dashboard.
- Your **passkey's secret part** never leaves your device.

## Back up your data

Do this now and then, especially in guest mode or the mobile app.

1. Open **Settings → Data**.
2. Tap **Export backup (JSON)**.
3. Keep the file somewhere safe. It is named `gymme-backup-YYYY-MM-DD.json`.

On the mobile app, the backup goes out through your phone's **share sheet**, so you can send it to Files, email,
cloud storage and so on.

### Restore a backup

1. **Settings → Data → Import backup**, then choose the file.
2. Confirm. **This replaces all current data** with the file's contents.

## Move from guest mode to a profile

Create a profile in **Settings → Account**. Gymme moves the data from this device into the new profile.

## Bring your history from another app

Tap **Settings → Data → Import from another app** and choose the file you exported from:

| App | File |
|---|---|
| **FitNotes** (Android and iOS) | The CSV export. |
| **Strong** | The CSV export. |
| **Hevy** | The CSV export. |
| **Apple Health** | The `export.xml` file. Only **body weight** is imported. |

Other apps that export a CSV with a **date, an exercise name and a weight/reps/time** column often work too.

Before anything is saved, Gymme shows a preview: how many workouts, sets and exercises it found, and how many
are new. Then:

- Exercise names are matched to the library. Anything it cannot match becomes **one of your own exercises**, so
  nothing in the file is dropped.
- If the file is in a different unit than your profile, weights are **converted** and Gymme tells you so.
- Days that already have data are **left alone**.
- If the file records RPE, it is imported as effort.

## Share a plan (not your data)

See [Plan and routines](02-plan-and-routines.md#share-your-plan). Plan files contain only routines and the week
schedule.

## Sign out, and "Sign out everywhere"

- **Sign out** syncs your data first, then clears it from this device. Sign in again to get it back.
- **Sign out everywhere** also ends the sessions on all your other devices. Your passkey keeps working.
  Use it if a device is lost.

## Delete your data

- **On a device:** **Settings → Data → Reset everything** deletes the plan, workouts and body weight on this device.
  If you are signed in, that empty state syncs to your profile too, so export a backup first.
- **From the server:** ask the person who runs it. They can remove your profile files (see the
  [technical docs](../technical/data-model.md)).
