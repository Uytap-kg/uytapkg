"use client";

import { useEffect, useState } from "react";
import {
  Scale,
  ShieldCheck,
  FileCheck2,
  SearchCheck,
  Phone,
  MessageCircle,
  ArrowRight,
  CheckCircle2,
  BadgeCheck,
  Clock3,
} from "lucide-react";

import styles from "./Lawyers.module.css";
import Header from "@/components/pageComponents/header/Header";
import Footer from "@/components/pageComponents/footer/Footer";
import { getLawyers } from "@/utils/api";
import AdBanner from "@/components/pageComponents/addBanner/AdBanner";

import { useLanguage } from "@/context/LanguageContext";

const benefits = [
  {
    key: "documents",
    icon: FileCheck2,
  },
  {
    key: "risks",
    icon: SearchCheck,
  },
  {
    key: "saferDeal",
    icon: ShieldCheck,
  },
];

export default function Lawyers() {
  const { t } = useLanguage();

  const [lawyers, setLawyers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLawyers()
      .then((res) => {
        if (res.success) {
          setLawyers(res.data || []);
        }
      })
      .catch((err) => console.error("Ошибка загрузки юристов:", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className={styles.page}>
      <Header />

      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />

      <div className={styles.container}>
        {/* HERO */}

        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.eyebrow}>
              <Scale />
              {t("lawyers.hero.eyebrow")}
            </div>

            <h1>
              {t("lawyers.hero.title")}
              <span> {t("lawyers.hero.titleAccent")}</span>
            </h1>

            <p>{t("lawyers.hero.description")}</p>

            <div className={styles.heroActions}>
              <a href="#lawyers" className={styles.primaryButton}>
                {t("lawyers.hero.chooseLawyer")}
                <ArrowRight />
              </a>

              <div className={styles.trust}>
                <BadgeCheck />
                <span>{t("lawyers.hero.trust")}</span>
              </div>
            </div>
          </div>

          <div className={styles.heroCard}>
            <div className={styles.heroCardIcon}>
              <ShieldCheck />
            </div>

            <span className={styles.heroCardLabel}>UYТAP LEGAL</span>

            <h2>{t("lawyers.hero.cardTitle")}</h2>

            <div className={styles.heroChecks}>
              <div>
                <CheckCircle2 />
                {t("lawyers.hero.checks.documents")}
              </div>

              <div>
                <CheckCircle2 />
                {t("lawyers.hero.checks.risks")}
              </div>

              <div>
                <CheckCircle2 />
                {t("lawyers.hero.checks.consultation")}
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}

        <section className={styles.infoSection}>
          <div className={styles.sectionHeading}>
            <span>01</span>

            <div>
              <h2>{t("lawyers.howItWorks.title")}</h2>

              <p>{t("lawyers.howItWorks.description")}</p>
            </div>
          </div>

          <div className={styles.steps}>
            <div className={styles.step}>
              <div className={styles.stepNumber}>01</div>

              <div>
                <h3>{t("lawyers.howItWorks.steps.choose.title")}</h3>

                <p>{t("lawyers.howItWorks.steps.choose.text")}</p>
              </div>
            </div>

            <div className={styles.step}>
              <div className={styles.stepNumber}>02</div>

              <div>
                <h3>{t("lawyers.howItWorks.steps.request.title")}</h3>

                <p>{t("lawyers.howItWorks.steps.request.text")}</p>
              </div>
            </div>

            <div className={styles.step}>
              <div className={styles.stepNumber}>03</div>

              <div>
                <h3>{t("lawyers.howItWorks.steps.contact.title")}</h3>

                <p>{t("lawyers.howItWorks.steps.contact.text")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* BENEFITS */}

        <section className={styles.infoSection}>
          <div className={styles.sectionHeading}>
            <span>02</span>

            <div>
              <h2>{t("lawyers.benefits.title")}</h2>

              <p>{t("lawyers.benefits.description")}</p>
            </div>
          </div>

          <div className={styles.benefits}>
            {benefits.map((item) => {
              const Icon = item.icon;

              return (
                <article className={styles.benefit} key={item.key}>
                  <div className={styles.benefitIcon}>
                    <Icon />
                  </div>

                  <h3>{t(`lawyers.benefits.items.${item.key}.title`)}</h3>

                  <p>{t(`lawyers.benefits.items.${item.key}.text`)}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* LAWYERS */}

        <section id="lawyers" className={styles.lawyersSection}>
          <div className={styles.sectionHeading}>
            <span>03</span>

            <div>
              <h2>{t("lawyers.list.title")}</h2>

              <p>{t("lawyers.list.description")}</p>
            </div>
          </div>

          {loading ? (
            <p className={styles.stateMessage}>{t("lawyers.list.loading")}</p>
          ) : lawyers.length === 0 ? (
            <p className={styles.stateMessage}>{t("lawyers.list.empty")}</p>
          ) : (
            <div className={styles.lawyersGrid}>
              {lawyers.map((lawyer) => {
                const fullName = [lawyer.lastName, lawyer.firstName]
                  .filter(Boolean)
                  .join(" ");

                const initials = `${
                  lawyer.firstName?.[0] || ""
                }${lawyer.lastName?.[0] || ""}`;

                return (
                  <article className={styles.lawyerCard} key={lawyer.id}>
                    <div className={styles.lawyerTop}>
                      <div className={styles.avatar}>{initials}</div>

                      <div className={styles.verified}>
                        <BadgeCheck />
                        {t("lawyers.list.verified")}
                      </div>
                    </div>

                    <div className={styles.lawyerInfo}>
                      <h3>{fullName}</h3>

                      <div className={styles.specialization}>
                        <Scale />
                        {lawyer.specialization}
                      </div>

                      {lawyer.description && (
                        <p className={styles.lawyerDescription}>
                          {lawyer.description}
                        </p>
                      )}
                    </div>

                    <div className={styles.lawyerMeta}>
                      <div>
                        <Clock3 />
                        {lawyer.experience}
                      </div>
                    </div>

                    <div className={styles.contacts}>
                      {lawyer.phone && (
                        <div className={styles.phoneContact}>
                          <a className={styles.phone}>
                            <Phone />
                            {lawyer.phone}
                          </a>
                        </div>
                      )}

                      {lawyer.whatsapp && (
                        <a
                          href={`https://wa.me/${lawyer.whatsapp.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.whatsapp}
                        >
                          <MessageCircle />
                          WhatsApp
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* CTA */}

        <section className={styles.bottomCta}>
          <div className={styles.bottomCtaIcon}>
            <Scale />
          </div>

          <div>
            <span>{t("lawyers.cta.eyebrow")}</span>

            <h2>
              {t("lawyers.cta.title")}
              <br />
              {t("lawyers.cta.titleAccent")}
            </h2>

            <p>{t("lawyers.cta.description")}</p>
          </div>

          <a href="#lawyers" className={styles.ctaButton}>
            {t("lawyers.cta.button")}
            <ArrowRight />
          </a>
        </section>
      </div>

      <AdBanner />

      <Footer />
    </main>
  );
}
