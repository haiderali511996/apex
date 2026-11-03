// Windows: electron-builder needs Wine to brand the .exe when building on a Mac,
// so the icon and details are set here with resedit (pure JavaScript) instead.
const path = require("node:path"), fs = require("node:fs");
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit");
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit.default ?? ResEdit;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const executable = NtExecutable.from(fs.readFileSync(exe));
  const resources = NtExecutableResource.from(executable);
  const icon = Data.IconFile.from(fs.readFileSync(path.join(__dirname, "..", "icons", "icon.ico")));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries, groups[0]?.id ?? 1, groups[0]?.lang ?? 1033, icon.icons.map(i => i.data));
  const [version] = Resource.VersionInfo.fromEntries(resources.entries);
  if (version) {
    const lang = { lang: 1033, codepage: 1200 };
    version.setStringValues(lang, { ProductName: "UNC Assistant", FileDescription: "UNC Assistant", CompanyName: "UNC Team", LegalCopyright: "© UNC Team" });
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  fs.writeFileSync(exe, Buffer.from(executable.generate()));
};
