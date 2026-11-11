import RealtorProfileLoader from "./RealtorProfileLoader";

export default async function RealtorProfilePage({ params }) {
  const { id } = await params;

  return <RealtorProfileLoader profileId={id} />;
}
