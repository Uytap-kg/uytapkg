import { REGIONS, LOCATIONS_BY_REGION } from "../constants/locations.js";
import { RESORT_AMENITIES, GENERAL_AMENITIES } from "../constants/amenities.js";
import { PROPERTY_TYPES, DEAL_TYPES, RENT_PERIODS } from "../constants/propertyTypes.js";

export const getConstants = (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        regions: REGIONS,
        locationsByRegion: LOCATIONS_BY_REGION,
        amenities: {
          resort: RESORT_AMENITIES,
          general: GENERAL_AMENITIES,
        },
        propertyTypes: PROPERTY_TYPES,
        dealTypes: DEAL_TYPES,
        rentPeriods: RENT_PERIODS,
      },
    });
  } catch (error) {
    console.error("Error in getConstants controller:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении справочников.",
    });
  }
};
