/**
 * Approximate district search centres derived from Rwanda Space Agency's
 * public Administrative Boundaries FeatureServer district layer.
 *
 * Source: https://gh.space.gov.rw/server/rest/services/Admin_Boundaries/FeatureServer/1
 * Retrieved: 2026-07-30
 *
 * These centroids are a resilient fallback for nearby-pharmacy matching when
 * browser geolocation is unavailable. They are not presented as exact customer
 * addresses and must not be used as proof of a delivery address.
 */
type DistrictTuple = readonly [name: string, latitude: number, longitude: number];

export const RWANDA_DISTRICT_GROUPS: readonly (readonly [province: string, districts: readonly DistrictTuple[]])[] = [
  ["City of Kigali", [
    ["Gasabo", -1.891474, 30.142191],
    ["Kicukiro", -2.00885, 30.143801],
    ["Nyarugenge", -1.992016, 30.028855],
  ]],
  ["Eastern Province", [
    ["Bugesera", -2.239738, 30.150154],
    ["Gatsibo", -1.619755, 30.444602],
    ["Kayonza", -1.844629, 30.64181],
    ["Kirehe", -2.234389, 30.710376],
    ["Ngoma", -2.183007, 30.457122],
    ["Nyagatare", -1.338879, 30.380437],
    ["Rwamagana", -1.975481, 30.354733],
  ]],
  ["Northern Province", [
    ["Burera", -1.466257, 29.826482],
    ["Gakenke", -1.698552, 29.784282],
    ["Gicumbi", -1.621702, 30.113799],
    ["Musanze", -1.49856, 29.606608],
    ["Rulindo", -1.739361, 29.987239],
  ]],
  ["Southern Province", [
    ["Gisagara", -2.618197, 29.843583],
    ["Huye", -2.524647, 29.708781],
    ["Kamonyi", -2.009444, 29.902358],
    ["Muhanga", -1.954807, 29.722716],
    ["Nyamagabe", -2.411338, 29.469847],
    ["Nyanza", -2.335918, 29.793521],
    ["Nyaruguru", -2.69485, 29.516855],
    ["Ruhango", -2.193634, 29.771729],
  ]],
  ["Western Province", [
    ["Karongi", -2.156564, 29.431279],
    ["Ngororero", -1.879422, 29.570825],
    ["Nyabihu", -1.648671, 29.5098],
    ["Nyamasheke", -2.37347, 29.166254],
    ["Rubavu", -1.65397, 29.342715],
    ["Rusizi", -2.565382, 29.087505],
    ["Rutsiro", -1.9034, 29.398994],
  ]],
] as const;
