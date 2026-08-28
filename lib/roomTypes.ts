// Matches the room_type Postgres enum (0001_init.sql) and the staging ROOM_TYPE catalog.
export const ROOM_TYPES = [
  { value: "living_room", label: "Living Room" },
  { value: "kitchen", label: "Kitchen" },
  { value: "dining", label: "Dining" },
  { value: "main_bedroom", label: "Main Bedroom" },
  { value: "bedroom_2", label: "Bedroom 2" },
  { value: "bedroom_3", label: "Bedroom 3" },
  { value: "bedroom_4", label: "Bedroom 4" },
  { value: "bathroom_ensuite", label: "Bathroom/Ensuite" },
  { value: "office", label: "Office" },
  { value: "outdoor_patio", label: "Outdoor/Patio" },
  { value: "other", label: "Other" },
] as const
