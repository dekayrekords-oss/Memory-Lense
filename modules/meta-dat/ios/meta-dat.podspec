require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'meta-dat'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = package['license']
  s.author         = 'Memory Lens'
  s.homepage       = 'https://example.invalid'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { :git => 'https://example.invalid' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # NOTE: MWDATCore / MWDATCamera ship as a Swift Package
  # (github.com/facebook/meta-wearables-dat-ios) and cannot be consumed
  # through CocoaPods. Add the package to the generated iOS project in
  # Xcode (File > Add Package Dependencies) before building — see
  # modules/meta-dat/README.md.

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
