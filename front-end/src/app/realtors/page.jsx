"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Phone,
  MessageCircle,
  ArrowRight,
  BriefcaseBusiness,
} from "lucide-react";

import styles from "./RealtorsPage.module.css";
import Header from "@/components/pageComponents/header/Header";

import { getRealtors } from "@/api/auth"; // замени путь на свой API-файл

const DEFAULT_IMAGE = "/assets/realtorImage.png";

export default function RealtorsPage() {
  const router = useRouter();

  const [realtors, setRealtors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    const fetchRealtors = async () => {
      try {
        setLoading(true);
        setError("");

        const token = localStorage.getItem("token");

        if (!token) {
          throw new Error("Не удалось получить токен авторизации");
        }

        const data = await getRealtors(token, {
          signal: controller.signal,
        });

        setRealtors(data);
      } catch (err) {
        if (err.name !== "AbortError") {
          setError(err.message || "Не удалось загрузить риэлторов");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchRealtors();

    return () => controller.abort();
  }, []);

  const getWhatsAppLink = (phone, name) => {
    if (!phone) return "#";

    const cleanPhone = phone.replace(/\D/g, "");

    const message = encodeURIComponent(
      `Здравствуйте, ${name}! Нашёл(ла) ваш профиль на UyTap.kg. Хотел(а) бы узнать подробнее о ваших предложениях.`,
    );

    return `https://wa.me/${cleanPhone}?text=${message}`;
  };

  const getFullName = (user) => {
    return (
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.name ||
      "Риэлтор"
    );
  };

  const getUserImage = (user) => {
    return user.image || user.avatar || user.profileImage || DEFAULT_IMAGE;
  };

  const getUserId = (user) => {
    return user._id || user.id;
  };

  return (
    <main className={styles.container}>
      <Header />

      <section className={styles.hero}>
        <div className={styles.headerContent}>
          <span className={styles.eyebrow}>
            <BriefcaseBusiness size={15} />
            НАШИ СПЕЦИАЛИСТЫ
          </span>

          <h1>Найдите своего риэлтора</h1>

          <p>
            Профессионалы недвижимости, готовые помочь вам найти идеальное
            жильё.
          </p>
        </div>

        <div className={styles.counter}>
          <strong>{realtors.length}</strong>
          <span>риэлторов на платформе</span>
        </div>
      </section>

      <div className={styles.sectionTop}>
        <div>
          <h2>Все риэлторы</h2>
          <p>Выберите специалиста и свяжитесь с ним напрямую</p>
        </div>

        <span className={styles.results}>{realtors.length} специалистов</span>
      </div>

      {loading ? (
        <div className={styles.message}>Загрузка риэлторов...</div>
      ) : error ? (
        <div className={styles.message}>{error}</div>
      ) : realtors.length === 0 ? (
        <div className={styles.message}>
          Пока нет зарегистрированных риэлторов.
        </div>
      ) : (
        <section className={styles.grid}>
          {realtors.map((realtor) => {
            const fullName = getFullName(realtor);
            const userId = getUserId(realtor);
            const phone = realtor.phone || realtor.phoneNumber || "";

            return (
              <article
                key={userId}
                className={styles.card}
                onClick={() => router.push(`/realtors/${userId}`)}
              >
                <div className={styles.imageWrapper}>
                  <img
                    src={getUserImage(realtor)}
                    alt={fullName}
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
                    <h3>{fullName}</h3>

                    {phone && (
                      <div className={styles.phone}>
                        <Phone size={15} />
                        <span>{phone}</span>
                      </div>
                    )}
                  </div>

                  <div className={styles.actions}>
                    {phone && (
                      <a
                        href={getWhatsAppLink(phone, fullName)}
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
                        router.push(`/realtors/${userId}`);
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
