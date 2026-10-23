const { withPodfile } = require("expo/config-plugins");

// Xcode 27 rejects any target below iOS 15, and some pods (ReachabilitySwift,
// RNSVG, RNCAsyncStorage) still declare 12–13. Raise every pod to the app's floor.
const POD_DEPLOYMENT_TARGET = "15.1";
const MARKER = "# with-pod-deployment-target";

const SNIPPET = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        if Gem::Version.new(config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '0') < Gem::Version.new('${POD_DEPLOYMENT_TARGET}')
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${POD_DEPLOYMENT_TARGET}'
        end
      end
    end`;

module.exports = function withPodDeploymentTarget(config) {
  return withPodfile(config, (podfileConfig) => {
    const contents = podfileConfig.modResults.contents;
    if (contents.includes(MARKER)) return podfileConfig;
    const anchor = "post_install do |installer|";
    if (!contents.includes(anchor)) {
      throw new Error("with-pod-deployment-target: Podfile has no post_install block");
    }
    podfileConfig.modResults.contents = contents.replace(anchor, anchor + SNIPPET);
    return podfileConfig;
  });
};
