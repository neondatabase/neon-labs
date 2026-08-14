// Legacy recovery actions use this path. Keep it as a safe alias of the
// inspected, explicitly-confirmed teardown flow; it never accepts resource
// names and never force-drops an active replication slot.
export { POST } from "../teardown/route";
