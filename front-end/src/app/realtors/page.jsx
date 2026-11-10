"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAllUsers } from "@/utils/api";
import { Phone, MessageCircle, ArrowRight } from "lucide-react";
import styles from "./Realtors.module.css";

const DEFAULT_IMAGE = "/assets/realtorImage.png";

export default function RealtorsPage() {
  const router = useRouter();

  const [realtors, setRealtors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchRealtors = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await getAllUsers();

        // Поддерживаем разные форматы ответа API
        const users =
          response.users || response.data || response.data?.users || [];

        const filteredRealtors = users.filter(
          (user) => user.type === "realtor",
        );

        setRealtors(filteredRealtors);
      } catch (err) {
        console.error("Error loading realtors:", err);
        setError(err.message || "Не удалось загрузить риэлторов");
      } finally {
        setLoading(false);
      }
    };

    fetchRealtors();
  }, []);

  const getFullName = (realtor) => {
    const profile = realtor.profile || {};

    return (
      [
        profile.firstName || realtor.firstName || realtor.name,
        profile.lastName || realtor.lastName,
      ]
        .filter(Boolean)
        .join(" ") || "Риэлтор"
    );
  };

  const getPhoto = (realtor) => {
    const profile = realtor.profile || {};

    return (
      profile.avatar ||
      profile.photo ||
      profile.image ||
      realtor.avatar ||
      realtor.photo ||
      realtor.image ||
      DEFAULT_IMAGE
    );
  };

  const getPhone = (realtor) => {
    const profile = realtor.profile || {};

    return profile.phone || realtor.phone || realtor.phoneNumber || "";
  };

  const getWhatsAppLink = (phone, name) => {
    const cleanPhone = phone.replace(/\D/g, "");

    if (!cleanPhone) return null;

    const message = encodeURIComponent(
      `Здравствуйте, ${name}! Нашёл(ла) ваш профиль на UyTap.kg. Хотел(а) бы узнать подробнее о ваших предложениях.`,
    );

    return `https://wa.me/${cleanPhone}?text=${message}`;
  };

  if (loading) {
    return (
      <main className={styles.state}>
        <div className={styles.loader} />
        <p>Загружаем риэлторов...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className={styles.state}>
        <h2>Не удалось загрузить риэлторов</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>
          Попробовать снова
        </button>
      </main>
    );
  }

  return (
    <main className={styles.container}>
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>UYТАР.KG</span>
          <h1>Наши риэлторы</h1>
          <p>
            Найдите профессионального специалиста по недвижимости и свяжитесь с
            ним напрямую.
          </p>
        </div>

        <div className={styles.counter}>
          <strong>{realtors.length}</strong>
          <span>специалистов</span>
        </div>
      </section>

      {realtors.length === 0 ? (
        <div className={styles.empty}>
          <h2>Пока нет риэлторов</h2>
          <p>Список специалистов скоро появится.</p>
        </div>
      ) : (
        <section className={styles.grid}>
          {realtors.map((realtor) => {
            const name = getFullName(realtor);
            const phone = getPhone(realtor);
            const whatsappLink = getWhatsAppLink(phone, name);

            return (
              <article
                key={realtor._id || realtor.id}
                className={styles.card}
                onClick={() =>
                  router.push(`/realtors/${realtor._id || realtor.id}`)
                }
              >
                <div className={styles.imageWrapper}>
                  <img
                    src={getPhoto(realtor)}
                    alt={name}
                    className={styles.image}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = DEFAULT_IMAGE;
                    }}
                  />

                  <span className={styles.typeBadge}>Риэлтор</span>
                </div>

                <div className={styles.cardContent}>
                  <div className={styles.info}>
                    <h3>{name}</h3>

                    {phone ? (
                      <div className={styles.phone}>
                        <Phone size={15} />
                        <span>{phone}</span>
                      </div>
                    ) : (
                      <p className={styles.noPhone}>Номер не указан</p>
                    )}
                  </div>

                  <div className={styles.actions}>
                    {whatsappLink && (
                      <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.whatsapp}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MessageCircle size={17} />
                        WhatsApp
                      </a>
                    )}

                    <button
                      type="button"
                      className={styles.profileButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/realtors/${realtor._id || realtor.id}`);
                      }}
                    >
                      Профиль
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
