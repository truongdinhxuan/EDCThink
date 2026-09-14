export const APP_LAYER = {
  main: 10,
  header: 20,
  navigationBackdrop: 30,
  navigation: 40,
  filterBackdrop: 50,
  filterDrawer: 51,
  dropdown: 70,
  primaryBackdrop: 80,
  primaryDrawer: 81,
  // Portaled combobox popovers opened from inside the primary drawer: must clear
  // the drawer panel + its sticky footer (81) yet stay under confirmation (90+).
  primaryDrawerPopover: 85,
  confirmationBackdrop: 90,
  confirmationDrawer: 91,
  toast: 100,
  tooltip: 200,
} as const;
