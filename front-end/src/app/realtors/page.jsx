"use client";

import { useRouter } from "next/navigation";
import {
  Phone,
  MessageCircle,
  ArrowRight,
  BriefcaseBusiness,
} from "lucide-react";

import styles from "./RealtorsPage.module.css";
import Header from "@/components/pageComponents/header/Header";

const DEFAULT_IMAGE = "/assets/realtorImage.png";

const realtors = [
  {
    id: "1",
    firstName: "Александр",
    lastName: "Иванов",
    phone: "+996 555 123 456",
    image: DEFAULT_IMAGE,
  },
  {
    id: "2",
    firstName: "Мария",
    lastName: "Петрова",
    phone: "+996 700 456 789",
    image: DEFAULT_IMAGE,
  },
  {
    id: "3",
    firstName: "Данияр",
    lastName: "Садыков",
    phone: "+996 777 234 567",
    image: DEFAULT_IMAGE,
  },
  {
    id: "4",
    firstName: "Алина",
    lastName: "Осмонова",
    phone: "+996 550 111 222",
    image: DEFAULT_IMAGE,
  },
  {
    id: "5",
    firstName: "Тимур",
    lastName: "Абдрахманов",
    phone: "+996 990 333 444",
    image: DEFAULT_IMAGE,
  },
  {
    id: "6",
    firstName: "Эльмира",
    lastName: "Касымова",
    phone: "+996 555 987 654",
    image: DEFAULT_IMAGE,
  },
];

export default function RealtorsPage() {
  const router = useRouter();

  const getWhatsAppLink = (phone, name) => {
    const cleanPhone = phone.replace(/\D/g, "");

    const message = encodeURIComponent(
      `Здравствуйте, ${name}! Нашёл(ла) ваш профиль на UyTap.kg. Хотел(а) бы узнать подробнее о ваших предложениях.`,
    );

    return `https://wa.me/${cleanPhone}?text=${message}`;
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

      <section className={styles.grid}>
        {realtors.map((realtor) => {
          const fullName = `${realtor.firstName} ${realtor.lastName}`;

          return (
            <article
              key={realtor.id}
              className={styles.card}
              onClick={() => router.push(`/realtors/${realtor.id}`)}
            >
              <div className={styles.imageWrapper}>
                <img
                  src={realtor.image || DEFAULT_IMAGE}
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

                  <div className={styles.phone}>
                    <Phone size={15} />
                    <span>{realtor.phone}</span>
                  </div>
                </div>

                <div className={styles.actions}>
                  <a
                    href={getWhatsAppLink(realtor.phone, fullName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.whatsapp}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MessageCircle size={17} />
                    WhatsApp
                  </a>

                  <button
                    type="button"
                    className={styles.profileButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/realtors/${realtor.id}`);
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
    </main>
  );
}
