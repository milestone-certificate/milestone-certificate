import { describe, expect, it } from "vitest";
import {
  buildSvpReservationBody,
  buildSvpReservationPaymentBody,
  getSvpMonthDateRange,
  parseSvpAvailableDates,
  parseSvpCities,
  parseSvpCredits,
  parseSvpExamSessions,
  parseSvpOccupations,
  parseSvpPermissions,
  isSvpLanguageRejection,
  parseSvpPayment,
  parseSvpPayments,
  parseSvpNotifications,
  parseSvpCertificatePrice,
  parseSvpPrometricSites,
  parseSvpPrometricSlots,
  parseSvpAccountPermissions,
  parseSvpConstraints,
  parseSvpFeatureFlags,
  parseSvpReservation,
  parseSvpReservationDetail,
  parseSvpReservations,
  parseSvpHoldSessionId,
  parseSvpFlag,
  parseSvpCategories,
  svpExamSessionIdListSchema,
  svpExamSessionIdSchema,
  svpExamSessionIdStringSchema,
  svpLanguageCodeSchema,
  svpTicketFileName,
} from "@/lib/svp-api.shared";
import { extractSvpAuthPayload, extractSvpSessionUser } from "@/lib/svp-session.shared";

describe("SVP booking payload", () => {
  it("matches the portal payment body for a reservation", () => {
    expect(buildSvpReservationPaymentBody("6124304")).toEqual({
      payment: {
        payment_method: "card",
        payable_type: "Reservation",
        payable_id: 6124304,
      },
    });
  });

  it("matches the portal create-reservation body exactly", () => {
    expect(
      buildSvpReservationBody({
        examSessionId: 501,
        occupationId: 11,
        languageCode: "en",
        duration: 3600,
        startAt: "2026-11-05 09:30:00",
        siteId: null,
        siteCity: "Dhaka",
        holdId: null,
        countryId: 4,
      }),
    ).toEqual({
      exam_session_id: 501,
      occupation_id: 11,
      language_code: "en",
      methodology: "in_person",
      site_id: null,
      site_city: "Dhaka",
      hold_id: null,
      duration: 3600,
      start_at: "2026-11-05 09:30:00",
      country_id: 4,
    });
  });
});

describe("SVP response parsers", () => {
  it("reads occupations with category and language codes", () => {
    const occupations = parseSvpOccupations({
      occupations: [
        {
          id: 11,
          name: "Welder",
          arabic_name: "لحام",
          occupation_key: "721201",
          category: {
            id: 159,
            name: "Welding",
            prometric_codes: [
              { code: "en", name: "English", question_count: 30 },
              { code: "ar", name: "Arabic", question_count: 30 },
              { code: "en", name: "English", question_count: 30 },
            ],
          },
        },
      ],
    });

    expect(occupations).toEqual([
      {
        id: 11,
        name: "Welder",
        arabicName: "لحام",
        occupationKey: "721201",
        categoryId: 159,
        categoryName: "Welding",
        languages: [
          { code: "en", label: "English", questionCount: 30, nonTargeted: false },
          { code: "ar", label: "Arabic", questionCount: 30, nonTargeted: false },
        ],
        driverLicenseRequired: false,
      },
    ]);
  });

  it("loads category languages from SVP permissions and accepts long provider IDs/codes", () => {
    const languageCode = "prometric_english_30_question_category_exam";
    const examSessionId = "QhHSU5enEg--HeQIKA7MRogPRy6u--Md2sAG6krBtWYeqaM9UXeQ";

    expect(
      parseSvpCategories({
        data: {
          categories: [
            {
              id: 159,
              english_name: "Welding",
              prometric_codes: [
                { code: languageCode, name: "English", question_count: 30, non_targeted: false },
              ],
            },
          ],
        },
      }),
    ).toEqual([
      {
        id: 159,
        name: "Welding",
        arabicName: null,
        languages: [
          { code: languageCode, label: "English", questionCount: 30, nonTargeted: false },
        ],
      },
    ]);

    expect(svpExamSessionIdSchema.parse(examSessionId)).toBe(examSessionId);
    expect(svpExamSessionIdListSchema.parse([examSessionId])).toEqual([examSessionId]);
    expect(svpExamSessionIdStringSchema.parse(examSessionId)).toBe(examSessionId);
    expect(svpLanguageCodeSchema.parse(languageCode)).toBe(languageCode);
    expect(() => svpExamSessionIdSchema.parse("x".repeat(201))).toThrow();
    expect(() => svpLanguageCodeSchema.parse("x".repeat(121))).toThrow();

    expect(
      buildSvpReservationBody({
        examSessionId,
        occupationId: 11,
        languageCode,
        siteId: null,
        siteCity: null,
        holdId: null,
        countryId: 4,
      }),
    ).toMatchObject({ exam_session_id: examSessionId, language_code: languageCode });
  });

  it("reads test center cities and de-duplicates them", () => {
    expect(
      parseSvpCities({
        cities: [
          { city: "Dhaka", country_id: 4 },
          { city: "dhaka", country_id: 4 },
          { city: "Chattogram", country: { id: 4 } },
        ],
      }),
    ).toEqual([
      { city: "Chattogram", countryId: 4 },
      { city: "Dhaka", countryId: 4 },
    ]);
  });

  it("accepts common city-name aliases from SVP city responses", () => {
    expect(
      parseSvpCities({
        data: {
          available_cities: [
            { city_name: "Rajshahi", country_id: 4 },
            { english_name: "Dhaka", country_id: 4 },
          ],
        },
      }),
    ).toEqual([
      { city: "Dhaka", countryId: 4 },
      { city: "Rajshahi", countryId: 4 },
    ]);
  });

  it("accepts SVP city lists whose entries are plain strings", () => {
    expect(parseSvpCities({ data: ["Rajshahi", "Dhaka"] })).toEqual([
      { city: "Dhaka", countryId: null },
      { city: "Rajshahi", countryId: null },
    ]);
  });

  it("builds current and future month date ranges and rejects unsupported months", () => {
    const now = new Date("2026-10-31T11:00:00.000Z");
    expect(getSvpMonthDateRange("2026-10", now)).toEqual({
      startDate: "2026-10-31",
      endDate: "2026-10-31",
    });
    expect(getSvpMonthDateRange("2026-11", now)).toEqual({
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
    expect(getSvpMonthDateRange("2026-12", now)).toEqual({
      startDate: "2026-12-01",
      endDate: "2026-12-31",
    });
    expect(getSvpMonthDateRange("2026-09", now)).toBeNull();
    expect(getSvpMonthDateRange("2027-10", now)).toBeNull();
    expect(getSvpMonthDateRange("2026-13", now)).toBeNull();
  });

  it("reads permissions, credits and available dates", () => {
    expect(
      parseSvpPermissions({
        country: { id: 4, english_name: "Bangladesh", free_reservations: true, targeted: true },
      }),
    ).toEqual({
      freeReservations: true,
      targeted: true,
      loadBalancer: false,
      testPrice: null,
      countryId: 4,
      countryName: "Bangladesh",
    });
    expect(parseSvpCredits({ data: { reservation_credits: 2 } })).toBe(2);
    expect(
      parseSvpAvailableDates({
        available_dates: [
          {
            start_at_in_tc_time_zone: "2026-11-05 09:30:00",
            test_center: { city: "Dhaka", name: "Dhaka Center" },
          },
        ],
      }),
    ).toEqual([
      { startAt: "2026-11-05 09:30:00", city: "Dhaka", centerName: "Dhaka Center", seats: null },
    ]);
  });

  it("reads exam sessions with seat and duration data", () => {
    expect(
      parseSvpExamSessions({
        exam_sessions: [
          {
            id: 501,
            start_at: "2026-11-05 09:30:00",
            end_at: "2026-11-05 10:30:00",
            duration: 3600,
            available_seats: 7,
            test_center: { city: "Dhaka", name: "Dhaka Center" },
          },
        ],
      }),
    ).toEqual([
      {
        id: 501,
        startAt: "2026-11-05 09:30:00",
        endAt: "2026-11-05 10:30:00",
        duration: 3600,
        availableSeats: 7,
        city: "Dhaka",
        centerName: "Dhaka Center",
        siteId: null,
      },
    ]);
  });

  it("prefers the supplied test-center-local session time over UTC values", () => {
    expect(
      parseSvpExamSessions({
        exam_sessions: [
          {
            id: "session-local-time",
            start_at: "2026-10-28T03:30:00Z",
            startDateTime: "2026-10-28T03:30:00Z",
            start_at_in_tc_time_zone: "2026-10-28 09:30:00",
            end_at: "2026-10-28T04:30:00Z",
            end_at_in_tc_time_zone: "2026-10-28 10:30:00",
            test_center: { city: "Nilphamari", name: "Nilphamari Test Center" },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        startAt: "2026-10-28 09:30:00",
        endAt: "2026-10-28 10:30:00",
        centerName: "Nilphamari Test Center",
        availableSeats: null,
        duration: 0,
      }),
    ]);
  });

  it("preserves flat test-center names and site slot seat counts", () => {
    const centerName =
      "Cumilla Technical Training Centre, Assessment and Skill Verification Campus";
    expect(
      parseSvpExamSessions({
        sessions: [
          {
            id: 501,
            start_at: "2026-12-01 09:30:00",
            test_center_name: centerName,
            available_seats: "7",
          },
        ],
      })[0],
    ).toMatchObject({ centerName, availableSeats: 7 });
    expect(
      parseSvpPrometricSlots([
        {
          site_id: 9,
          slots: [
            {
              id: "slot-local",
              startDateTime: "2026-12-01T03:30:00Z",
              start_at_in_tc_time_zone: "2026-12-01 09:30:00",
              available_seats: 0,
            },
          ],
        },
      ])[0],
    ).toMatchObject({ startAt: "2026-12-01 09:30:00", availableSeats: 0 });
  });

  it("reads the created reservation id and the account reservation list", () => {
    expect(parseSvpReservation({ data: { id: 987 } })).toEqual({
      id: "987",
      status: null,
    });
    expect(
      parseSvpReservations({
        exam_reservations: [
          {
            id: 987,
            reservation_status: "reserved",
            can_be_rescheduled: true,
            category_id: 159,
            occupation: { name: "Welder", english_name: "Welder" },
            labor: { full_name: "Noor Rahman" },
            exam_session: {
              id: 501,
              duration: 3600,
              start_at: "2026-11-05 09:30:00",
              test_center: { city: "Dhaka", name: "Dhaka Center" },
            },
          },
        ],
      }),
    ).toEqual([
      {
        id: "987",
        status: "reserved",
        laborName: "Noor Rahman",
        occupationName: "Welder",
        occupationEnglishName: "Welder",
        city: "Dhaka",
        centerName: "Dhaka Center",
        startAt: "2026-11-05 09:30:00",
        methodology: null,
        languageCode: null,
        examResult: null,
        finalResult: null,
        totalScore: null,
        cbtScore: null,
        practicalScore: null,
        certificate: null,
        canBeRescheduled: true,
        categoryId: 159,
        examSessionId: 501,
        duration: 3600,
      },
    ]);
  });
});

describe("SVP OTP session extraction", () => {
  it("reads access token, expiry and labor identity from the OTP payload", () => {
    const payload = {
      data: {
        access_payload: { access: "ACCESS_TOKEN", access_expires_at: "2026-11-05T10:00:00Z" },
        user: { id: 969955, full_name: "Noor Rahman", country: { targeted: true } },
      },
    };

    expect(extractSvpAuthPayload(payload)).toEqual({
      access: "ACCESS_TOKEN",
      accessExpiresAt: Math.floor(Date.parse("2026-11-05T10:00:00Z") / 1000),
    });
    expect(extractSvpSessionUser(payload)).toEqual({
      id: "969955",
      name: "Noor Rahman",
      passport: null,
      countryTargeted: true,
      countryLoadBalancer: null,
    });
  });

  it("also accepts a refresh-style body without the data envelope", () => {
    expect(extractSvpAuthPayload({ access: "NEW_TOKEN", access_expires_at: 1800000000 })).toEqual({
      access: "NEW_TOKEN",
      accessExpiresAt: 1800000000,
    });
  });
});

describe("SVP ticket file name", () => {
  it("uses the candidate name and occupation English name", () => {
    expect(svpTicketFileName("Noor Rahman", "Welder")).toBe("Noor_Rahman_Welder_SVP_Ticket.pdf");
    expect(svpTicketFileName("  md. sojib / hossain ", "Heavy Equipment Operator")).toBe(
      "md_sojib_hossain_Heavy_Equipment_Operator_SVP_Ticket.pdf",
    );
  });

  it("falls back safely when a value is missing or not Latin text", () => {
    expect(svpTicketFileName(null, undefined)).toBe("Candidate_Occupation_SVP_Ticket.pdf");
    expect(svpTicketFileName("  ", "")).toBe("Candidate_Occupation_SVP_Ticket.pdf");
  });
});

describe("SVP reschedule and account parsers", () => {
  it("reads reservation details needed for rescheduling", () => {
    const detail = parseSvpReservationDetail({
      data: {
        id: 987,
        reservation_status: "reserved",
        can_be_rescheduled: true,
        occupation_id: 11,
        occupation: { name: "Welder", english_name: "Welder" },
        category: {
          id: 159,
          name: "Welding",
          prometric_codes: [{ code: "en", name: "English" }],
        },
        exam_session: {
          id: 501,
          duration: 3600,
          start_at_in_tc_time_zone: "2026-11-05 09:30:00",
          test_center: { city: "Dhaka", name: "Dhaka Center" },
        },
      },
    });

    expect(detail).toEqual({
      id: "987",
      status: "reserved",
      laborName: null,
      occupationName: "Welder",
      occupationEnglishName: "Welder",
      city: "Dhaka",
      centerName: "Dhaka Center",
      startAt: "2026-11-05 09:30:00",
      methodology: null,
      languageCode: null,
      examResult: null,
      finalResult: null,
      totalScore: null,
      cbtScore: null,
      practicalScore: null,
      certificate: null,
      canBeRescheduled: true,
      categoryId: 159,
      examSessionId: 501,
      duration: 3600,
      occupationId: 11,
      categoryName: "Welding",
      languages: [{ code: "en", label: "English", questionCount: null, nonTargeted: false }],
      countryId: null,
    });
  });

  it("reads constraints, feature flags and labor permission keys", () => {
    expect(
      parseSvpConstraints({
        data: {
          reservation_rescheduling: 2,
          reservation_duration: 600,
          labor_reservation_cancellation_limit: 48,
        },
      }),
    ).toEqual({ rescheduleTimes: 2, bookingHoldSeconds: 600, cancellationLimitHours: 48 });

    expect(
      parseSvpFeatureFlags({
        feature_flags: [
          { name: "enable_labor_rescheduling_flow", state: "true" },
          { name: "labor_reservation_credits", state: "false" },
        ],
      }),
    ).toEqual({ rescheduleEnabled: true, creditsEnabled: false });

    const permissions = parseSvpAccountPermissions({
      country: { id: 4, english_name: "Bangladesh", free_reservations: false, targeted: true },
      permissions: {
        legislator: {
          labors: {
            book_appointment: true,
            reschedule_appointment: true,
            cancel_appointment: false,
          },
        },
      },
    });

    expect(permissions.freeReservations).toBe(false);
    expect(permissions.targeted).toBe(true);
    expect(permissions.permissionKeys).toEqual(["book_appointment", "reschedule_appointment"]);
  });
});

describe("SVP site-based booking parsers", () => {
  it("reads sites, exam id and available dates", () => {
    expect(
      parseSvpPrometricSites({
        data: {
          exam_id: "555",
          sites: [
            {
              site_id: 9,
              test_center: {
                name: "Site A",
                address: { locality: "Dhaka", formattedAddress: "1 Test Road, Dhaka" },
              },
              available_dates: ["2026-12-01", "2026-12-02T00:00:00"],
            },
          ],
        },
      }),
    ).toEqual({
      examId: "555",
      sites: [
        {
          siteId: 9,
          name: "Site A",
          city: "Dhaka",
          address: "1 Test Road, Dhaka",
          dates: ["2026-12-01", "2026-12-02"],
        },
      ],
    });
  });

  it("reads slots grouped by site", () => {
    expect(
      parseSvpPrometricSlots([
        {
          site_id: 9,
          slots: [{ id: "slot-1", startDateTime: "2026-12-01T10:00:00", duration: 30 }],
        },
      ]),
    ).toEqual([{ id: "slot-1", siteId: 9, startAt: "2026-12-01T10:00:00", duration: 30 }]);
  });

  it("normalizes dd/mm/yyyy prometric dates so month filters and slot matching still work", () => {
    expect(
      parseSvpPrometricSites({
        data: {
          exam_id: "555",
          sites: [
            {
              site_id: 9,
              test_center: { name: "Site A", address: { locality: "Dhaka" } },
              available_dates: ["01/12/2026", { date: "05/12/2026" }, "2026-12-09"],
            },
          ],
        },
      }).sites[0]?.dates,
    ).toEqual(["2026-12-01", "2026-12-05", "2026-12-09"]);
    expect(
      parseSvpPrometricSlots([
        {
          site_id: 9,
          slots: [
            { id: "slot-1", startDateTime: "01/12/2026 10:00", duration: 30 },
            { id: "slot-2", start_at: "2026-12-01T14:00:00", duration: 30 },
          ],
        },
      ]),
    ).toEqual([
      { id: "slot-1", siteId: 9, startAt: "2026-12-01 10:00", duration: 30 },
      { id: "slot-2", siteId: 9, startAt: "2026-12-01T14:00:00", duration: 30 },
    ]);
    expect(
      parseSvpAvailableDates({
        available_dates: [
          { start_at_in_tc_time_zone: "01/12/2026 09:30:00", test_center: { city: "Dhaka" } },
        ],
      })[0]?.startAt,
    ).toBe("2026-12-01 09:30:00");
    expect(
      parseSvpExamSessions({
        exam_sessions: [
          {
            id: 777,
            start_at_in_tc_time_zone: "01/12/2026 11:00:00",
            test_center: { city: "Dhaka", name: "Dhaka Center" },
          },
        ],
      })[0]?.startAt,
    ).toBe("2026-12-01 11:00:00");
  });
});

describe("SVP targeted load-balancer sessions", () => {
  it("keeps the string session token and date-only start field", () => {
    const sessions = parseSvpExamSessions({
      exam_sessions: [
        {
          id: "QhHSU5enEg--HeQIKA7MRogPRy6u--Md2sAG6krBtWYeqaM9UXeQ",
          status: "scheduled",
          start_date_in_tc_time_zone: "2026-10-25",
          test_center: { city: "Dhaka", country_id: 78 },
        },
      ],
    });

    expect(sessions).toEqual([
      {
        id: "QhHSU5enEg--HeQIKA7MRogPRy6u--Md2sAG6krBtWYeqaM9UXeQ",
        startAt: "2026-10-25",
        endAt: null,
        duration: 0,
        availableSeats: null,
        city: "Dhaka",
        centerName: null,
        siteId: null,
      },
    ]);
  });
});

describe("SVP occupation languages", () => {
  it("detects a rejected language code from the provider message", () => {
    expect(isSvpLanguageRejection("The selected language code is invalid.")).toBe(true);
    expect(isSvpLanguageRejection("Prometric code not supported")).toBe(true);
    expect(isSvpLanguageRejection("This seat is no longer available.")).toBe(false);
    expect(isSvpLanguageRejection(null)).toBe(false);
  });

  it("reads prometric codes and language lists from the occupation and its category", () => {
    const [occupation] = parseSvpOccupations({
      occupations: [
        {
          id: 11,
          name: "Welder",
          category_id: 159,
          prometric_codes: [
            { code: "en", name: "English", question_count: 30, non_targeted: false },
          ],
          languages: [{ name: "Bengali" }, "Urdu"],
        },
      ],
    });

    expect(occupation?.languages).toEqual([
      { code: "en", label: "English", questionCount: 30, nonTargeted: false },
      { code: "bn", label: "Bengali", questionCount: null, nonTargeted: false },
      { code: "ur", label: "Urdu", questionCount: null, nonTargeted: false },
    ]);
  });

  it("falls back to the nested category language list", () => {
    const [occupation] = parseSvpOccupations({
      occupations: [
        {
          id: 12,
          name: "Mason",
          category: { id: 160, name: "Construction", languages: ["English", "Arabic"] },
        },
      ],
    });

    expect(occupation?.languages.map((entry) => entry.code)).toEqual(["en", "ar"]);
  });
});

describe("SVP payments, notifications and certificate price", () => {
  it("maps payment rows from the list and a single detail payload", () => {
    const payment = {
      id: 2596452,
      amount: 85,
      status: "paid",
      payable_type: "RESERVATION",
      payable_id: 4066364,
      created_at: "2026-10-20T10:00:00Z",
      response: { transaction_status: "success" },
      invoice: { id: 77 },
    };

    expect(parseSvpPayments({ data: { payments: [payment] } })).toEqual([
      {
        id: "2596452",
        amount: 85,
        status: "paid",
        transactionStatus: "success",
        reservationId: "4066364",
        invoiceId: "77",
        createdAt: "2026-10-20T10:00:00Z",
      },
    ]);
    expect(parseSvpPayment({ data: { payment } })?.id).toBe("2596452");
  });

  it("maps notifications and the certificate price", () => {
    expect(
      parseSvpNotifications({
        notifications: [
          {
            id: "n1",
            title: "Payment received",
            body: "Your card payment was confirmed.",
            created_at: "2026-10-20",
            read_at: null,
          },
        ],
      }),
    ).toEqual([
      {
        id: "n1",
        title: "Payment received",
        message: "Your card payment was confirmed.",
        createdAt: "2026-10-20",
        read: false,
      },
    ]);

    expect(parseSvpCertificatePrice({ data: { certificate_price: 50, currency: "SAR" } })).toEqual({
      amount: 50,
      currency: "SAR",
    });
  });

  it('reads the notification flag without turning SVP\'s string "0" into read', () => {
    const readFlag = (entry: Record<string, unknown>) =>
      parseSvpNotifications({ notifications: [{ id: "n1", ...entry }] })[0]?.read;

    expect(readFlag({ read_at: "2026-10-21T09:00:00Z" })).toBe(true);
    expect(readFlag({ read_at: null, read: "0" })).toBe(false);
    expect(readFlag({ read_at: null, read: 0 })).toBe(false);
    expect(readFlag({ read_at: null, read: "1" })).toBe(true);
    expect(readFlag({ read_at: null, read: true })).toBe(true);
    expect(readFlag({ seen: "false" })).toBe(false);
    expect(readFlag({})).toBe(false);
  });
});

describe("SVP flag and hold parsers", () => {
  it("never treats SVP's string falsy flags as true", () => {
    // Boolean("0") is true, which used to mark non-reschedulable rows as reschedulable.
    expect(parseSvpFlag("0")).toBe(false);
    expect(parseSvpFlag(0)).toBe(false);
    expect(parseSvpFlag("false")).toBe(false);
    expect(parseSvpFlag("")).toBe(false);
    expect(parseSvpFlag(null)).toBe(false);
    expect(parseSvpFlag(undefined)).toBe(false);
    expect(parseSvpFlag("no")).toBe(false);
    expect(parseSvpFlag({})).toBe(false);

    expect(parseSvpFlag(true)).toBe(true);
    expect(parseSvpFlag(1)).toBe(true);
    expect(parseSvpFlag("1")).toBe(true);
    expect(parseSvpFlag(" TRUE ")).toBe(true);
    expect(parseSvpFlag("yes")).toBe(true);
    expect(parseSvpFlag("on")).toBe(true);
  });

  it("parses can_be_rescheduled from lists and detail without truthiness coercion", () => {
    const reservation = (value: unknown) =>
      parseSvpReservations({
        data: { exam_reservations: [{ id: 5, can_be_rescheduled: value }] },
      })[0]?.canBeRescheduled;
    expect(reservation("0")).toBe(false);
    expect(reservation("1")).toBe(true);
    expect(reservation(true)).toBe(true);
    expect(reservation(undefined)).toBe(false);

    const detail = (value: unknown) =>
      parseSvpReservationDetail({ data: { id: 6, can_be_rescheduled: value } })?.canBeRescheduled;
    expect(detail("0")).toBe(false);
    expect(detail("1")).toBe(true);
  });

  it("reads the session token SVP assigns on a temporary-seat hold", () => {
    expect(parseSvpHoldSessionId({ data: { exam_session_id: 1466849 } })).toBe(1466849);
    expect(parseSvpHoldSessionId({ exam_session_id: "1466849" })).toBe("1466849");
    expect(parseSvpHoldSessionId({ data: { exam_session_id: " 777 " } })).toBe("777");
    // 0 is SVP's broken-hold marker, not a session id.
    expect(parseSvpHoldSessionId({ data: { exam_session_id: 0 } })).toBeNull();
    expect(parseSvpHoldSessionId({ data: { exam_session_id: "0" } })).toBeNull();
    expect(parseSvpHoldSessionId({ data: { exam_session_id: null } })).toBeNull();
    expect(parseSvpHoldSessionId({ data: { exam_session_id: "" } })).toBeNull();
    expect(parseSvpHoldSessionId({ data: { exam_session_id: {} } })).toBeNull();
    expect(parseSvpHoldSessionId(null)).toBeNull();
  });
});
