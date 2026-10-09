// Which profile is active. Kept in its own module so the data modules can read it without import cycles.
let activeProfile = 1;

export const getProfileId = (): number => activeProfile;
export const setProfileId = (id: number): void => { activeProfile = id; };
