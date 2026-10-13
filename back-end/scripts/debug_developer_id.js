import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const targetId = "65f1cce8-e3f6-4294-8978-2bf62d7448bc";
  console.log(`Checking UUID: ${targetId}`);

  const { data: userRow } = await supabase
    .from("users")
    .select("*")
    .eq("id", targetId)
    .maybeSingle();

  console.log("User row in 'users' table:", userRow);

  const { data: devRow } = await supabase
    .from("developers")
    .select("*")
    .eq("id", targetId)
    .maybeSingle();

  console.log("Developer row in 'developers' table by id:", devRow);

  const { data: devRowByUser } = await supabase
    .from("developers")
    .select("*")
    .eq("user_id", targetId)
    .maybeSingle();

  console.log("Developer row in 'developers' table by user_id:", devRowByUser);

  const { data: profileRow } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", targetId)
    .maybeSingle();

  console.log("Profile row in 'user_profiles' table by user_id:", profileRow);
}

check();
