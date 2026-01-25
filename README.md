# Forma-Mobile-Fitness-App

Forma is an AI-powered fitness app that uses real-time camera-based pose estimation to analyse exercise form as you train. By combining on-device computer vision with biomechanical heuristics, Forma detects key body joints, tracks movement quality, and gives instant feedback on technique, range of motion, and consistency.

# Forma-MediaPipe

This version uses the MediaPipe pose landmark model to detect 33 key points on the human body and output co-ordinates in 3d space. This is the default version for the production app.

# Forma-MoveNet

This version uses the MoveNet Thunder/Lightning models to detect 17 key points on the human body and output co-ordinates in 2d space. This is the backup version for the production app.

# To run the app on Android:

1. Plug Phone into laptop via usb-c or run via simulator 

2. Install dependencies: 'npm install'

3. Prebuild the app: 'npx expo prebuild --platform android'

4. Build the app: 'npx expo run:android'

5. If wanting to launch remotely:
    Run 'npx expo start --dev-client --tunnel'

   If wanting to launch over wired connection:
    Run 'adb reverse tcp:8081 tcp:8081'
    Followed by 'npx expo start --dev-client'



# To run the app on IOS:

1. Plug Phone into laptop via usb-c or run via simulator 

2. Install dependencies: 'npm install'

4. Build the app: 'npx expo run:ios'

5. Start Metro Bundler
    If wanting to launch remotely: 'npx expo start --dev-client --tunnel'

    If wanting to launch over wired connection: 'adb reverse tcp:8081 tcp:8081'
    Followed by 'npx expo start --dev-client'