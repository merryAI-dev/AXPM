import { productConfig } from "../product-config";

export function defaultDriveConfig() {
  const config = productConfig();
  return { rootId: config.driveRootId, label: config.programName };
}
