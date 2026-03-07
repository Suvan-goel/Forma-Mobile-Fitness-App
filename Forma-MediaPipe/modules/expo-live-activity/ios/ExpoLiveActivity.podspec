Pod::Spec.new do |s|
  s.name           = 'ExpoLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Expo module for iOS Live Activity / Dynamic Island workout timer'
  s.description    = 'Bridges React Native to iOS ActivityKit for workout Live Activities'
  s.license        = 'MIT'
  s.author         = 'Forma'
  s.homepage       = 'https://github.com/forma'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.source_files   = '**/*.swift'

  s.dependency 'ExpoModulesCore'
end
