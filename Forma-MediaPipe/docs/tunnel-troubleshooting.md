# Expo Tunnel Troubleshooting

## Error: `TypeError: Cannot read properties of undefined (reading 'body')`

This error occurs when using `npx expo start --dev-client --tunnel` and Ngrok fails to establish a connection.

### Quick Fix: Use LAN Mode

Run without tunnel (phone and computer must be on the same WiFi):

```bash
npm run start:lan
```

Or:

```bash
npx expo start --dev-client
```

### If You Need Tunnel Mode

1. **Install dependencies** (ensures @expo/ngrok is present):
   ```bash
   npm install
   ```

2. **Fix Ngrok config** (if tunnel still fails):
   - Check for a corrupted `~/.ngrok` folder
   - If you see unexpected files (e.g. `.zip` files) in `~/.ngrok`:
     ```bash
     rm -rf ~/.ngrok
     ```
   - Re-authenticate: sign up at [ngrok.com](https://ngrok.com), get your auth token, and run:
     ```bash
     npx ngrok config add-authtoken YOUR_TOKEN
     ```

3. **Check Ngrok status**: [https://status.ngrok.com/](https://status.ngrok.com/)
