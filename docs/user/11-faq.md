# 11. Questions and problems

## Signing in

**I do not get a passkey prompt on my phone.**
The address must start with `https://`. Passkeys do not work on `http://` addresses (except `localhost` on
the same computer). Ask the person running the server to set up HTTPS.

**It says "verification failed" when I sign in.**
The server is set up with a different address than the one you typed. Make sure you use the exact address the
server owner gave you. If it keeps happening, tell them — it is usually a setup mismatch they can fix.

**It says "unknown passkey — create a profile first".**
The passkey you picked is not registered on this server. Try another passkey from the list, or tap
**Create new profile**.

**I lost my phone / my passkey.**
Sign in from another device using the same passkey if it is saved in your password manager or keychain. If
nothing has the passkey, the profile cannot be recovered. Create a new one and import your latest backup
(**Settings → Data → Import backup**). If your phone was stolen, use **Sign out everywhere** from another device
first, or ask the server owner to disable the old profile.

**It says "this account has been disabled".**
The server owner turned it off. Ask them.

**It asks for an invite code.**
This server is invite-only. Ask the owner for a code. Each code works once.

**"a valid invite code is required" / "invite code is no longer valid".**
The code is wrong, was already used, or was cancelled. Ask for a new one.

## Workouts

**My phone locks during a workout.**
Check **Settings → During a workout → Keep screen awake**. It needs an HTTPS connection and does not work in
iPhone Low Power Mode.

**I have no rest-timer alert when the app is closed.**
Turn on **Settings → Notifications → Push notifications** and allow notifications in your browser. You need to be
signed in and on an HTTPS address. On iPhone, the web app must be added to the home screen first.

**The weight Gymme suggests looks wrong.**
Open the exercise in your routine and check its **Progression → Rule**. The note under the exercise in the
workout explains the number. You can also set the rule to **No automatic progression**.

**I cannot find the RIR / RPE column.**
It is off by default. Turn it on in **Settings → During a workout → Effort per set**.

**I closed the app in the middle of a workout.**
Open Gymme and tap **Resume**. The workout is saved on that device. If you started it on a different device,
you will not see it on this one.

**I logged a workout by mistake.**
Open it from **Stats → Recent workouts**, the **History** screen or the calendar, and tap **Delete workout**.

## Data

**My data disappeared.**
In guest mode, data lives in the browser and is lost if the browser data is cleared. Import a backup. Signed-in
profiles keep their data on the server.

**Switching kg ↔ lb changed nothing about my numbers.**
Right: the setting changes only the label. See [Settings](08-settings.md#general).

**The reminder arrives at the wrong time.**
Turn the **Workout day reminder** off and on again so it re-detects your time zone.

**Where are my exercise animations?**
On first start the server downloads about 140 MB of exercise images. If they are missing, ask the server owner
to check it.

## Friends

**Can my friends see my weight, my food or my workouts?**
No. Friends only see the short summary you choose to share (sessions, consistency against your own plan, week streak,
and records if you allow it). Weight, measurements, food, effort, your mobility profile and exercise details are never
shared. Everything is off until you turn on **Settings → Friends & sharing**.

**How do I leave?**
Turn off **Share with friends** to disappear from everyone's screens, or use **Leave and erase friends data** to delete
what the friends module stores about you. Your own workouts are not touched. See
[Friends and challenges](12-friends-and-challenges.md#leave-and-erase).

**Why did my rank disappear?**
Either you or the friend turned on **Hide my rank**, so positions are not shown, or the list is sorted on something
that person did not share. People with no session yet, nothing planned or no recent activity are shown without a
position instead of at the bottom.

**My friend request says nobody can be added.**
The code expired or was replaced, the handle is wrong, or the person is not sharing or blocked you. Gymme gives the same
answer for all of these on purpose, so nobody can find out who uses the server.

**I do not see Crew or the friends settings.**
The person running your server can switch the friends module off, and it is not available in the demo or the standalone
Android app.

## Other

**Is there an iPhone app?**
No store app. Use the web app on your home screen. See [Install on your phone](10-install-on-your-phone.md).

**Does it cost anything? Does it track me?**
No subscription, no ads and no telemetry. Gymme is free and open source (AGPL v3).

**I found a bug or I want a feature.**
Open an issue or a discussion at <https://github.com/DuarteSantos8/openGym>. When you report a login problem,
include the address you use, but never your backup file.
