/**
 * Live values shared between the station's layers, written and read each
 * frame without going through React:
 *  - the 3D orbit camera, so the backdrop can parallax with it;
 *  - the backdrop's palette and scene styling, so the centrepiece can match
 *    the world it stands in.
 */
export const REST_POLAR = 1.457
export const REST_DIST = 11.9

export const link = {
  cam: { az: 0, polar: REST_POLAR, dist: REST_DIST },
  look: {
    a: [0.4, 0.7, 0.9] as [number, number, number],
    b: [0.5, 0.5, 0.9] as [number, number, number],
    c: [0.9, 0.5, 0.6] as [number, number, number],
    /** How the scene draws a game: 0 tower, 1 launch vehicle, 2 crystal, 3 lattice mast. */
    gstyle: 0,
    /** How the scene draws a lead: 0 firefly, 1 ship, 2 window, 3 lantern. */
    lstyle: 0,
  },
}
