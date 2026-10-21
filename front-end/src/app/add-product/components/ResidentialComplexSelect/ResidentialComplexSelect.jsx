"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";

import { useLanguage } from "@/context/LanguageContext";
import { getComplexes } from "@/utils/api";
import CustomSelect from "@/components/ui/customSelect/CustomSelect";

import styles from "./ResidentialComplexSelect.module.css";
import LoadingScreen from "@/components/ui/loadingScreen/LoadingScreen";

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFirstValue(...values) {
  return (
    values.find(
      (value) => value !== undefined && value !== null && String(value).trim(),
    ) || ""
  );
}

function buildOptions(complexes) {
  const prepared = complexes.map((complex) => ({
    ...complex,
    label: complex.city ? `${complex.name} — ${complex.city}` : complex.name,
  }));

  const counts = new Map();

  prepared.forEach(({ label }) => {
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  const seen = new Set();

  return prepared.map((complex) => {
    let label = complex.label;

    if (counts.get(label) > 1 && complex.address) {
      label = `${label}, ${complex.address}`;
    }

    let suffix = 1;

    while (seen.has(label)) {
      label = `${complex.label} (${suffix++})`;
    }

    seen.add(label);

    return { ...complex, label };
  });
}

function matchesLocation(complex, { country, city, district, region }) {
  const complexCity = normalize(complex.city);
  const complexDistrict = normalize(complex.district);
  const complexCountry = normalize(complex.country);
  const complexRegion = normalize(complex.region);
  const complexAddress = normalize(complex.address);

  const selectedCity = normalize(city);
  const selectedDistrict = normalize(district);
  const selectedRegion = normalize(region);

  const addressAndLocation = [
    complexAddress,
    complexCity,
    complexDistrict,
    complexRegion,
  ]
    .filter(Boolean)
    .join(" ");

  // Если у ЖК сохранена страна, исключаем ЖК из другой страны.
  if (complexCountry && country) {
    const countryAliases = {
      kyrgyzstan: ["кыргызстан", "киргизия", "kyrgyzstan", "kg"],
      turkey: ["турция", "turkey", "türkiye", "tr"],
    };

    const aliases = countryAliases[country] || [normalize(country)];

    if (!aliases.some((alias) => complexCountry.includes(normalize(alias)))) {
      return false;
    }
  }

  // Проверяем выбранный город или населённый пункт.
  if (selectedCity) {
    const cityMatches =
      complexCity === selectedCity ||
      complexCity.includes(selectedCity) ||
      selectedCity.includes(complexCity) ||
      (!complexCity && addressAndLocation.includes(selectedCity));

    if (!cityMatches) return false;
  }

  // Если выбран район, ЖК должен иметь совпадающий район
  // либо выбранный район должен встречаться в его адресе.
  if (selectedDistrict) {
    const districtMatches =
      complexDistrict === selectedDistrict ||
      complexDistrict.includes(selectedDistrict) ||
      selectedDistrict.includes(complexDistrict) ||
      complexAddress.includes(selectedDistrict);

    if (!districtMatches) return false;
  }

  // Для областей Кыргызстана учитываем область, если она сохранена у ЖК.
  if (selectedRegion && complexRegion) {
    const regionMatches =
      complexRegion === selectedRegion ||
      complexRegion.includes(selectedRegion) ||
      selectedRegion.includes(complexRegion);

    if (!regionMatches) return false;
  }

  return true;
}

export default function ResidentialComplexSelect({
  value,
  onSelect,
  country = "",
  city = "",
  district = "",
  region = "",
}) {
  const { t } = useLanguage();

  const [complexes, setComplexes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchComplexes() {
      try {
        setLoading(true);
        setError(false);

        const res = await getComplexes();

        if (!mounted) return;

        const data = Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];

        const normalized = data
          .map((complex) => ({
            id: String(
              getFirstValue(complex?.id, complex?._id, complex?.complexId),
            ),
            name: getFirstValue(
              complex?.name,
              complex?.title,
              complex?.complex_name,
              complex?.name_ru,
            ),
            country: getFirstValue(
              complex?.country,
              complex?.countryName,
              complex?.country_name,
            ),
            region: getFirstValue(
              complex?.region,
              complex?.regionName,
              complex?.region_name,
            ),
            city: getFirstValue(
              complex?.city,
              complex?.cityName,
              complex?.city_name,
            ),
            district: getFirstValue(
              complex?.district,
              complex?.districtName,
              complex?.district_name,
            ),
            address: getFirstValue(
              complex?.address,
              complex?.fullAddress,
              complex?.full_address,
            ),
          }))
          .filter((complex) => complex.id && complex.name);

        setComplexes(buildOptions(normalized));
      } catch (err) {
        console.error("Failed to fetch residential complexes:", err);

        if (mounted) {
          setError(true);
          setComplexes([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchComplexes();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredComplexes = useMemo(() => {
    return complexes.filter((complex) =>
      matchesLocation(complex, {
        country,
        city,
        district,
        region,
      }),
    );
  }, [complexes, country, city, district, region]);

  // Если локация изменилась, выбранный ЖК больше не подходит.
  useEffect(() => {
    if (!value || !complexes.length) return;

    const selected = complexes.find(
      (complex) => complex.label === value || complex.name === value,
    );

    if (
      selected &&
      !matchesLocation(selected, { country, city, district, region })
    ) {
      onSelect?.({ id: null, name: "" });
    }
  }, [country, city, district, region, complexes, value, onSelect]);

  if (error) {
    return (
      <div className={styles.error}>
        <Building2 size={18} />
        <span>{t("residentialComplex.error")}</span>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <CustomSelect
        icon={Building2}
        title={t("residentialComplex.title")}
        value={value || ""}
        setValue={(label) => {
          const found = filteredComplexes.find(
            (complex) => complex.label === label,
          );

          onSelect?.(
            found
              ? {
                  id: found.id,
                  name: found.label,
                }
              : {
                  id: null,
                  name: label,
                },
          );
        }}
        options={
          loading ? [] : filteredComplexes.map((complex) => complex.label)
        }
      />

      {loading && (
        <span className={styles.loading}>
          <LoadingScreen />
        </span>
      )}
    </div>
  );
}
