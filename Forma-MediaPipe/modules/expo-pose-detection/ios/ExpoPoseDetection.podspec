Pod::Spec.new do |s|
  s.name           = 'ExpoPoseDetection'
  s.version        = '1.0.0'
  s.summary        = 'Expo module for MediaPipe pose detection'
  s.description    = 'Camera + MediaPipe PoseLandmarker integration for React Native via Expo Modules API'
  s.license        = 'MIT'
  s.author         = 'Forma'
  s.homepage       = 'https://github.com/forma'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.source_files   = '**/*.{h,m,swift}'
  s.resources      = 'Models/*.task'

  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision'
end
