#!/usr/bin/env python3
"""Generate a dependency-free Xcode project and separate production/demo Run schemes."""
import hashlib, pathlib, plistlib
root = pathlib.Path(__file__).resolve().parent
def ident(s): return hashlib.sha1(s.encode()).hexdigest()[:24].upper()
objects = {}
def add(key, value): objects[ident(key)] = value; return ident(key)
files=[]; builds=[]
for p in sorted(list((root/'Core').glob('*.swift'))+list((root/'App').glob('*.swift'))):
    rel=str(p.relative_to(root)); fid=add('file:'+rel, '{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "'+rel+'"; sourceTree = "<group>";}'); files.append(fid)
    builds.append(add('build:'+rel, '{isa = PBXBuildFile; fileRef = '+fid+';}'))
product=add('product','{isa = PBXFileReference; explicitFileType = wrapper.application; path = Kairetic.app; sourceTree = BUILT_PRODUCTS_DIR;}')
sources=add('sources','{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ('+','.join(builds)+'); runOnlyForDeploymentPostprocessing = 0;}')
asset=add('assets','{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";}')
files.append(asset)
assetBuild=add('assetBuild','{isa = PBXBuildFile; fileRef = '+asset+';}')
resources=add('resources','{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ('+assetBuild+'); runOnlyForDeploymentPostprocessing = 0;}')
frameworks=add('frameworks','{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;}')
signing=add('signing','{isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Signing.xcconfig; sourceTree = "<group>";}')
files.append(signing)
group=add('group','{isa = PBXGroup; children = ('+','.join(files+[product])+'); sourceTree = "<group>";}')
projectConfigs=[]; targetConfigs=[]
for mode in ['Debug','Release']:
    projectConfigs.append(add('project'+mode, '{isa = XCBuildConfiguration; buildSettings = {CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; SWIFT_STRICT_CONCURRENCY = complete;}; name = '+mode+';}'))
    settings={'PRODUCT_BUNDLE_IDENTIFIER':'com.kairetic.task','PRODUCT_NAME':'Kairetic','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','INFOPLIST_FILE':mode+'Info.plist','GENERATE_INFOPLIST_FILE':'NO','TARGETED_DEVICE_FAMILY':'1,2','CODE_SIGN_STYLE':'Automatic','MARKETING_VERSION':'0.1.0','CURRENT_PROJECT_VERSION':'1','SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else '', 'ENABLE_PREVIEWS':'YES', 'SUPPORTED_PLATFORMS':'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST':'NO'}
    targetConfigs.append(add('target'+mode,'{isa = XCBuildConfiguration; baseConfigurationReference = '+signing+'; buildSettings = {'+' '.join(k+' = "'+v+'";' for k,v in settings.items())+'}; name = '+mode+';}'))
pc=add('projectConfigs','{isa = XCConfigurationList; buildConfigurations = ('+','.join(projectConfigs)+'); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;}')
tc=add('targetConfigs','{isa = XCConfigurationList; buildConfigurations = ('+','.join(targetConfigs)+'); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;}')
target=add('target','{isa = PBXNativeTarget; buildConfigurationList = '+tc+'; buildPhases = ('+','.join([sources,frameworks,resources])+'); buildRules = (); dependencies = (); name = Kairetic; productName = Kairetic; productReference = '+product+'; productType = "com.apple.product-type.application";}')
project=add('project','{isa = PBXProject; attributes = {LastUpgradeCheck = 1610;}; buildConfigurationList = '+pc+'; compatibilityVersion = "Xcode 14.0"; developmentRegion = vi; hasScannedForEncodings = 0; knownRegions = (vi,en,Base); mainGroup = '+group+'; projectDirPath = ""; projectRoot = ""; targets = ('+target+');}')
(root/'Kairetic.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+'\n'.join(k+' = '+v+';' for k,v in objects.items())+'\n}; rootObject = '+project+';}\n')
for mode in ['Debug','Release']:
    info={'CFBundleDevelopmentRegion':'vi','CFBundleDisplayName':'Kairetic','CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'$(PRODUCT_NAME)','CFBundlePackageType':'APPL','CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)','LSRequiresIPhoneOS':True,'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False},'UILaunchScreen':{},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait','UIInterfaceOrientationPortraitUpsideDown','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],'CFBundleURLTypes':[{'CFBundleURLSchemes':['kairetic']}], 'ITSAppUsesNonExemptEncryption':False}
    if mode=='Debug': info['NSAppTransportSecurity']={'NSAllowsLocalNetworking':True, 'NSExceptionDomains':{'localhost':{'NSExceptionAllowsInsecureHTTPLoads':True},'127.0.0.1':{'NSExceptionAllowsInsecureHTTPLoads':True}}}
    with open(root/(mode+'Info.plist'),'wb') as f: plistlib.dump(info,f)
scheme='''<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="1610" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="TARGET" BuildableName="Kairetic.app" BlueprintName="Kairetic" ReferencedContainer="container:Kairetic.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="NO"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="TARGET" BuildableName="Kairetic.app" BlueprintName="Kairetic" ReferencedContainer="container:Kairetic.xcodeproj"/></BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>'''.replace('TARGET',target)
(root/'Kairetic.xcodeproj/xcshareddata/xcschemes/Kairetic.xcscheme').write_text(scheme)
print('Generated Kairetic.xcodeproj')

demo = scheme.replace("</BuildableProductRunnable></LaunchAction>", '</BuildableProductRunnable><EnvironmentVariables><EnvironmentVariable key="KAIRETIC_API_ORIGIN" value="http://localhost:3101" isEnabled="YES"/></EnvironmentVariables></LaunchAction>')
demo = demo.replace('selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB"', 'selectedDebuggerIdentifier=""').replace('selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB"', 'selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn"')
(root/"Kairetic.xcodeproj/xcshareddata/xcschemes/Kairetic Demo.xcscheme").write_text(demo)
