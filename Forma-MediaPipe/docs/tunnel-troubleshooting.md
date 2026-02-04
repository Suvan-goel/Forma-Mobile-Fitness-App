# Expo Tunnel Troubleshooting

## Error: `CommandError: failed to start tunnel` / `session closed`

This occurs when Ngrok cannot establish a tunnel. Common on **university WiFi (eduroam)**, corporate networks, or when Ngrok auth is missing.

### Quick fix: use LAN mode (recommended on restrictive networks)

**Phone and computer must be on the same WiFi:**

```bash
npm run start:lan
```

Or:

```bash
npx expo start --dev-client
```

Then scan the QR code with Expo Go (dev build). For eduroam: use a personal hotspot or different network if your phone can't reach your computer over LAN.

---

## Error: `TypeError: Cannot read properties of undefined (reading 'body')`

This occurs when using `npx expo start --dev-client --tunnel` and Ngrok fails to establish a connection. Use the same workarounds as above.

---

## If you need tunnel mode

### 1. Ngrok auth token (required)

Sign up at [ngrok.com](https://ngrok.com) (free), copy your auth token, then run:

```bash
npx ngrok config add-authtoken YOUR_TOKEN
```

### 2. Fix corrupted Ngrok config

If the tunnel still fails:

```bash
rm -rf ~/.ngrok
npx ngrok config add-authtoken YOUR_TOKEN
```

### 3. Network restrictions

- **Eduroam / university WiFi:** Often blocks Ngrok. Use LAN mode or a different network.
- **Corporate firewalls:** May block tunnel traffic. Try LAN or mobile hotspot.

### 4. Check Ngrok status

See [status.ngrok.com](https://status.ngrok.com/) for outages.
