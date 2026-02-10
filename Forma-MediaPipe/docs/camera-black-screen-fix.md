# Camera Black Screen – Clean Rebuild

If the camera shows a black screen when opening the Camera screen:

## 1. Reapply patches and createFragment fix

```bash
npm run postinstall
```

This runs `patch-package` and applies the createFragment retry fix (deferred camera fragment creation until the native view is ready).

## 2. Clean prebuild (regenerate native project)

```bash
npx expo prebuild --clean
```

This recreates the `android/` folder from scratch with the current dependencies.

## 3. Rebuild and run

```bash
npx expo run:android
```

## 4. Confirm camera permission

When the app first runs, approve the camera permission. You can also check in:

**Settings → Apps → Forma → Permissions** — ensure Camera is enabled.

## 5. If the screen is still black

- Fully close the app (remove from recent apps) and reopen it.
- Uninstall the app, then run `npx expo run:android` again to reinstall.
- Check the terminal for errors when opening the Camera screen.
