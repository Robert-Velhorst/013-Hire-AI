export const hooks = {
  readPackage(pkg) {
    if (pkg.name === "mammoth" && pkg.dependencies?.argparse) {
      // Hire.AI uses Mammoth's API, not its CLI that imports vulnerable sprintf-js.
      delete pkg.dependencies.argparse;
      delete pkg.bin;
    }

    return pkg;
  },
};
