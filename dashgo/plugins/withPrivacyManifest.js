/**
 * withPrivacyManifest — Expo config plugin
 *
 * Copies `assets/PrivacyInfo.xcprivacy` into the iOS app target's Resources
 * build phase. Required by Apple since May 1, 2024 for apps that use any
 * "Required Reason API" (and DashGo does — UserDefaults via expo-secure-store,
 * file timestamp, disk space, and system boot time via React Native internals).
 *
 * Implementation notes:
 *   1. `withDangerousMod` runs after native projects are generated; we use it
 *      to physically copy the file into the iOS Supporting folder.
 *   2. `withXcodeProject` then mutates project.pbxproj so the file is added
 *      to the main target's group AND to its PBXResourcesBuildPhase, which
 *      causes Xcode to bundle it into the .app at build time.
 *   3. We guard against double-registration by checking the resources phase
 *      before adding (in case the plugin is re-run during prebuild).
 *
 * Reference: Apple's "Describing data use in privacy manifests"
 *   https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
 */

const fs = require('fs')
const path = require('path')
const {
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins')
const {
  addResourceFileToGroup,
  getProjectName,
} = require('@expo/config-plugins/build/ios/utils/Xcodeproj')

const PRIVACY_MANIFEST_FILENAME = 'PrivacyInfo.xcprivacy'
const SOURCE_RELATIVE = path.join('assets', PRIVACY_MANIFEST_FILENAME)

const withCopyPrivacyManifest = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      const platformProjectRoot = cfg.modRequest.platformProjectRoot
      const projectName = getProjectName(projectRoot)

      const src = path.join(projectRoot, SOURCE_RELATIVE)
      if (!fs.existsSync(src)) {
        throw new Error(
          `[withPrivacyManifest] Expected ${SOURCE_RELATIVE} to exist at ${src}. ` +
            `Create the privacy manifest before prebuilding.`,
        )
      }

      const destDir = path.join(platformProjectRoot, projectName)
      const dest = path.join(destDir, PRIVACY_MANIFEST_FILENAME)

      await fs.promises.mkdir(destDir, { recursive: true })
      await fs.promises.copyFile(src, dest)

      return cfg
    },
  ])
}

const withRegisterPrivacyManifest = (config) => {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    const projectName = getProjectName(cfg.modRequest.projectRoot)

    // Path Xcode uses (relative to project root, i.e. inside the app group).
    const filePath = `${projectName}/${PRIVACY_MANIFEST_FILENAME}`

    // Avoid duplicate registration on re-runs.
    const resourcesPhase = project.pbxResourcesBuildPhaseObj(
      project.getFirstTarget().uuid,
    )
    const alreadyAdded =
      resourcesPhase &&
      Array.isArray(resourcesPhase.files) &&
      resourcesPhase.files.some(
        (f) =>
          typeof f.comment === 'string' &&
          f.comment.includes(PRIVACY_MANIFEST_FILENAME),
      )

    if (alreadyAdded) return cfg

    // Add to the main app group so Xcode "sees" the file, and to the
    // Resources build phase so it's bundled into the .app.
    addResourceFileToGroup({
      filepath: filePath,
      groupName: projectName,
      project,
      isBuildFile: true,
      verbose: false,
    })

    return cfg
  })
}

module.exports = function withPrivacyManifest(config) {
  config = withCopyPrivacyManifest(config)
  config = withRegisterPrivacyManifest(config)
  return config
}
