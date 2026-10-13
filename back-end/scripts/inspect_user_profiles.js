import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error fetching from user_profiles:", error);
  } else {
    console.log("Columns of user_profiles:", data.length > 0 ? Object.keys(data[0]) : "No rows found");
    console.log("Sample row:", data[0]);
  }
}

check();
