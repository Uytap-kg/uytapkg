"use client";

import {
  Search,
  Plus,
  Waves,
  Home,
  Building2,
  TrendingUp,
  Sparkles,
  ArrowRight,
  Compass,
  BedDouble,
} from "lucide-react";

import { useRouter } from "next/navigation";

import styles from "./IssykKul.module.css";
import Footer from "@/components/pageComponents/footer/Footer";
import AdBanner from "@/components/pageComponents/addBanner/AdBanner";

import { useLanguage } from "@/context/LanguageContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import Header from "@/components/pageComponents/header/Header";

const propertyTypes = [
  { key: "houses", icon: Home },
  { key: "guestHouses", icon: Building2 },
  { key: "land", icon: Compass },
  { key: "apartments", icon: BedDouble },
];

const benefits = [
  { key: "resortZone", icon: Waves },
  { key: "restAndLife", icon: Home },
  { key: "investmentPotential", icon: TrendingUp },
  { key: "differentFormats", icon: Sparkles },
];

export default function IssykKul() {
  const router = useRouter();
  const { t } = useLanguage();

  useDocumentTitle(
    "Недвижимость на Иссык-Куле — Курортное жилье и дома | UyTap",
  );

  const goToListings = () => router.push("/all-issykkul-products");
  const goToAddProduct = () => router.push("/add-product");

  return (
    <>
      <Header />

      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroOverlay} aria-hidden="true" />

          <div className={styles.heroContent}>
            <div className={styles.badge}>
              <Waves aria-hidden="true" />
              <span>{t("issykKul.hero.badge")}</span>
            </div>

            <h1>
              {t("issykKul.hero.title")}
              <br />
              {t("issykKul.hero.titleAccent")}
            </h1>

            <p>{t("issykKul.hero.description")}</p>

            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.mainButton}
                onClick={goToListings}
              >
                {t("issykKul.hero.viewObjects")}
                <ArrowRight size={18} aria-hidden="true" />
              </button>

              <button
                type="button"
                className={styles.whiteButton}
                onClick={goToAddProduct}
              >
                <span>
                  <Plus size={19} aria-hidden="true" />
                </span>
                {t("issykKul.hero.addObject")}
              </button>
            </div>
          </div>
        </section>

        {/* ADVERTISEMENT */}

        <AdBanner />

        {/* INTRODUCTION */}

        <section className={styles.intro}>
          <div className={styles.sectionHeading}>
            <span>{t("issykKul.intro.eyebrow")}</span>
            <h2>{t("issykKul.intro.title")}</h2>
          </div>

          <div className={styles.introGrid}>
            <div className={styles.introText}>
              <p>{t("issykKul.intro.paragraphOne")}</p>
              <p>{t("issykKul.intro.paragraphTwo")}</p>

              <button
                type="button"
                className={styles.textButton}
                onClick={goToListings}
              >
                {t("issykKul.intro.findProperty")}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.introCard}>
              <Waves size={34} aria-hidden="true" />
              <strong>{t("issykKul.intro.cardTitle")}</strong>
              <p>{t("issykKul.intro.cardText")}</p>
            </div>
          </div>
        </section>

        {/* PROPERTY TYPES */}

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span>{t("issykKul.propertyTypes.eyebrow")}</span>
            <h2>{t("issykKul.propertyTypes.title")}</h2>
            <p>{t("issykKul.propertyTypes.description")}</p>
          </div>

          <div className={styles.propertyGrid}>
            {propertyTypes.map(({ key, icon: Icon }) => (
              <article className={styles.propertyCard} key={key}>
                <div className={styles.cardIcon}>
                  <Icon size={23} aria-hidden="true" />
                </div>

                <h3>{t(`issykKul.propertyTypes.items.${key}.title`)}</h3>

                <p>{t(`issykKul.propertyTypes.items.${key}.description`)}</p>

                <button type="button" onClick={goToListings}>
                  {t("issykKul.propertyTypes.view")}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </section>

        {/* BENEFITS */}

        <section className={styles.benefitsSection}>
          <div className={styles.sectionHeading}>
            <span>{t("issykKul.benefits.eyebrow")}</span>
            <h2>{t("issykKul.benefits.title")}</h2>
          </div>

          <div className={styles.benefitsGrid}>
            {benefits.map(({ key, icon: Icon }) => (
              <article className={styles.benefit} key={key}>
                <div className={styles.benefitIcon}>
                  <Icon size={21} aria-hidden="true" />
                </div>

                <div>
                  <h3>{t(`issykKul.benefits.items.${key}.title`)}</h3>

                  <p>{t(`issykKul.benefits.items.${key}.description`)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* INVESTMENT */}

        <section className={styles.investment}>
          <div className={styles.investmentOverlay} aria-hidden="true" />

          <div className={styles.investmentContent}>
            <div className={styles.investmentIcon}>
              <TrendingUp size={27} aria-hidden="true" />
            </div>

            <span>{t("issykKul.investment.eyebrow")}</span>

            <h2>{t("issykKul.investment.title")}</h2>

            <p>{t("issykKul.investment.description")}</p>

            <button type="button" onClick={goToListings}>
              {t("issykKul.investment.button")}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </section>

        {/* QUICK SEARCH */}

        <section className={styles.quickSearch}>
          <div>
            <div className={styles.quickIcon}>
              <Search size={22} aria-hidden="true" />
            </div>

            <div>
              <span>{t("issykKul.quickSearch.eyebrow")}</span>
              <h2>{t("issykKul.quickSearch.title")}</h2>
              <p>{t("issykKul.quickSearch.description")}</p>
            </div>
          </div>

          <button type="button" onClick={goToListings}>
            {t("issykKul.quickSearch.button")}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </section>

        {/* ADD PROPERTY */}

        <section className={styles.addSection}>
          <div>
            <span>{t("issykKul.addObject.eyebrow")}</span>
            <h2>{t("issykKul.addObject.title")}</h2>
            <p>{t("issykKul.addObject.description")}</p>
          </div>

          <button type="button" onClick={goToAddProduct}>
            <Plus size={20} aria-hidden="true" />
            {t("issykKul.addObject.button")}
          </button>
        </section>
      </main>

      <Footer />
    </>
  );
}
