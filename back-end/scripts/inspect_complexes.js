import { supabase } from "../src/config/db.js";

async function run() {
  const { data: complexes, error: compErr } = await supabase.from("residential_complexes").select("*").limit(1);
  if (compErr) console.error("Complexes error:", compErr);
  else console.log("Complexes row:", complexes);
}

run().catch(console.error);
