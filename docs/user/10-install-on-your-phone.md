# 10. Install on your phone

There are two ways to have openGym on your phone. Pick the one that fits you.

| | **Web app** (add to home screen) | **Standalone app** (Android) |
|---|---|---|
| Needs a server | Yes — your openGym address | **No** |
| Account / sign-in | Passkey profile | None — the phone is the account |
| Sync between devices | Yes | **No** |
| Where data lives | On the server | On the phone only |
| Reminders | Push notifications from the server | Native notifications on the phone |
| Exercise animations | From your server | Loaded from the internet |
| Best for | Several devices, family and friends | A simple "install and go" tracker |

## Option 1 — Add the web app to your home screen

You get a full-screen app icon, offline support for the app screens, and sync.

**iPhone / iPad (Safari)**
1. Open your openGym address in **Safari**.
2. Tap **Share**.
3. Tap **Add to Home Screen**.

**Android (Chrome)**
1. Open your openGym address in **Chrome**.
2. Tap the **⋮** menu.
3. Tap **Add to Home screen**.

> Sign-in with a passkey needs a **secure (HTTPS) address**. If the address starts with `http://` and is not
> `localhost`, passkeys will not work, and you will only be able to use guest mode.

## Option 2 — Standalone Android app

The Android app is a single file you **install yourself** (a "sideload"). It is not on the Play Store, on purpose.

1. Download the **APK** from **https://opengym.duarte-santos.ch** on your phone.
2. Open the file. Android may ask you to allow installs from your browser. That is normal for apps outside the Play
   Store. Allow it for this install.
3. Open openGym. There is no sign-in: you go straight in.

Because there is no server:

- **Back up often** with **Settings → Data → Export backup (JSON)**. If you lose the phone, the data goes too.
- Reminders are native: **Settings → Notifications → Workout day reminder**. Android may ask for permission to
  schedule exact alarms so the reminder arrives on time.
- To update, install the newer APK over the old one.

## iPhone

Apple does not allow installing apps outside the App Store, so there is **no iPhone download**. Your options:

- **Best:** use the **web app** (Option 1) from a server. It is a full-screen app with sync and passkeys.
- **Advanced:** a developer can build the native app onto their own iPhone with Xcode (the signature runs out
  after 7 days with a free Apple ID). See the [developer guide](../technical/development.md#mobile-app-capacitor).

## Updating the web app

The web app updates itself. Close and re-open it. If you still see an old version, pull down to refresh or
close the app completely and open it again.
