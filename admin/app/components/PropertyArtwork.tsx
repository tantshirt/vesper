import Image, { type StaticImageData } from "next/image";
import { propertyImage } from "../../../app/app/components/propertyImage";
import alderCourt from "../../../app/public/brand/properties/alder-court.png";
import cedarRow from "../../../app/public/brand/properties/cedar-row.png";
import theMonroe from "../../../app/public/brand/properties/the-monroe.png";

const ARTWORK: Record<string, StaticImageData> = {
  "/brand/properties/the-monroe.png": theMonroe,
  "/brand/properties/cedar-row.png": cedarRow,
  "/brand/properties/alder-court.png": alderCourt,
};

export function PropertyArtwork({
  name,
  location,
  propertyId,
  priority = false,
}: {
  name: string;
  location?: string | null;
  propertyId?: string;
  priority?: boolean;
}) {
  const source = ARTWORK[propertyImage(name, propertyId)] ?? theMonroe;
  const place = location ? ` in ${location}` : "";

  return (
    <Image
      className="admin-property-art"
      src={source}
      alt={`${name}${place}`}
      fill
      sizes="(max-width: 720px) 100vw, 420px"
      priority={priority}
    />
  );
}
