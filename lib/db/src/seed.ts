import { db, pool, topicsTable, papersTable, claimsTable, studiesTable, evidenceLinksTable, claimSynthesisTable } from "./index";

async function seed() {
  console.log("Clearing existing data...");
  await db.delete(evidenceLinksTable);
  await db.delete(claimSynthesisTable);
  await db.delete(studiesTable);
  await db.delete(claimsTable);
  await db.delete(papersTable);
  await db.delete(topicsTable);

  console.log("Inserting topics...");
  const topics = await db.insert(topicsTable).values([
    {
      name: "Caffeine and Cardiovascular Health",
      slug: "caffeine-cardiovascular",
      description: "Effects of habitual caffeine consumption on heart disease, blood pressure, and cardiovascular mortality.",
      domain: "Cardiology",
    },
    {
      name: "SSRI Antidepressants Efficacy",
      slug: "ssri-efficacy",
      description: "Effectiveness of selective serotonin reuptake inhibitors for major depressive disorder across populations.",
      domain: "Psychiatry",
    },
    {
      name: "Statins for Primary Prevention",
      slug: "statins-primary-prevention",
      description: "Use of statin therapy in patients without prior cardiovascular events for risk reduction.",
      domain: "Cardiology",
    },
    {
      name: "Vitamin D Supplementation",
      slug: "vitamin-d-supplementation",
      description: "Health outcomes associated with vitamin D supplementation in adults, including bone, immune, and cardiovascular effects.",
      domain: "Nutrition",
    },
    {
      name: "Aspirin for Cardiovascular Prevention",
      slug: "aspirin-cv-prevention",
      description: "Low-dose aspirin for primary and secondary prevention of cardiovascular events, with attention to bleeding risk.",
      domain: "Cardiology",
    },
  ]).returning();

  const [coffeeT, ssriT, statinT, vitDT, aspirinT] = topics;

  console.log("Inserting papers...");
  const papers = await db.insert(papersTable).values([
    // Caffeine
    {
      topicId: coffeeT.id,
      title: "Coffee consumption and risk of type 2 diabetes: a systematic review and dose-response meta-analysis",
      authors: "Ding M, Bhupathiraju SN, Chen M, et al.",
      journal: "Diabetes Care",
      publicationYear: 2014,
      doi: "10.2337/dc13-1539",
      pmid: "24459154",
      abstract: "Pooled analysis of 28 prospective studies (1,109,272 participants) found a non-linear inverse association between coffee consumption and diabetes risk. Each additional cup per day was associated with a 9% lower risk of type 2 diabetes (RR 0.91, 95% CI 0.89-0.94).",
      methodologyType: "meta-analysis",
      sampleSize: 1109272,
      pValue: "<0.001",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      openAccessUrl: "https://care.diabetesjournals.org/content/37/2/569",
    },
    {
      topicId: coffeeT.id,
      title: "Long-term coffee consumption and risk of cardiovascular disease: a systematic review and dose-response meta-analysis",
      authors: "Ding M, Bhupathiraju SN, Satija A, et al.",
      journal: "Circulation",
      publicationYear: 2014,
      doi: "10.1161/CIRCULATIONAHA.113.005925",
      pmid: "24201300",
      abstract: "Meta-analysis of 36 studies with 1,279,804 participants found a U-shaped association: moderate coffee consumption (3-5 cups/day) associated with lowest CVD risk (RR 0.85, 95% CI 0.80-0.90).",
      methodologyType: "meta-analysis",
      sampleSize: 1279804,
      pValue: "<0.001",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
    },
    // SSRI
    {
      topicId: ssriT.id,
      title: "Comparative efficacy and acceptability of 21 antidepressant drugs for the acute treatment of adults with major depressive disorder",
      authors: "Cipriani A, Furukawa TA, Salanti G, et al.",
      journal: "The Lancet",
      publicationYear: 2018,
      doi: "10.1016/S0140-6736(17)32802-7",
      pmid: "29477251",
      abstract: "Network meta-analysis of 522 trials (116,477 participants) comparing 21 antidepressants. All antidepressants were more effective than placebo, with ORs ranging from 1.37 to 2.13 for response.",
      methodologyType: "meta-analysis",
      sampleSize: 116477,
      pValue: "<0.001",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
    },
    {
      topicId: ssriT.id,
      title: "Initial severity and antidepressant benefits: a meta-analysis of data submitted to the FDA",
      authors: "Kirsch I, Deacon BJ, Huedo-Medina TB, et al.",
      journal: "PLoS Medicine",
      publicationYear: 2008,
      doi: "10.1371/journal.pmed.0050045",
      pmid: "18303940",
      abstract: "FDA-submitted trials show that antidepressant-placebo differences increase with baseline severity but are clinically negligible for mild-to-moderate depression. Mean drug-placebo difference of 1.80 on HAM-D.",
      methodologyType: "meta-analysis",
      sampleSize: 5133,
      pValue: "<0.001",
      evidenceQuality: "B",
      replicationStatus: "partial",
    },
    // Statins
    {
      topicId: statinT.id,
      title: "Efficacy and safety of statin therapy in older people: a meta-analysis of individual participant data from 28 randomised controlled trials",
      authors: "Cholesterol Treatment Trialists' Collaboration",
      journal: "The Lancet",
      publicationYear: 2019,
      doi: "10.1016/S0140-6736(18)31942-1",
      pmid: "30712900",
      abstract: "Meta-analysis of 186,854 participants across 28 trials. Statin therapy reduced major vascular events by 21% per mmol/L LDL reduction (RR 0.79, 95% CI 0.77-0.81), with consistent benefit across age groups.",
      methodologyType: "meta-analysis",
      sampleSize: 186854,
      pValue: "<0.001",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
    },
    // Vitamin D
    {
      topicId: vitDT.id,
      title: "Vitamin D Supplements and Prevention of Cancer and Cardiovascular Disease (VITAL trial)",
      authors: "Manson JE, Cook NR, Lee IM, et al.",
      journal: "New England Journal of Medicine",
      publicationYear: 2019,
      doi: "10.1056/NEJMoa1809944",
      pmid: "30415629",
      abstract: "Randomized trial of 25,871 adults receiving 2000 IU/day vitamin D3 vs placebo over median 5.3 years. No significant reduction in invasive cancer (HR 0.96) or major cardiovascular events (HR 0.97).",
      methodologyType: "rct",
      sampleSize: 25871,
      pValue: "0.47",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
    },
    {
      topicId: vitDT.id,
      title: "Effects of vitamin D supplementation on musculoskeletal health: a systematic review",
      authors: "Bolland MJ, Grey A, Avenell A.",
      journal: "The Lancet Diabetes & Endocrinology",
      publicationYear: 2018,
      doi: "10.1016/S2213-8587(18)30265-1",
      pmid: "30293909",
      abstract: "Meta-analysis of 81 RCTs (53,537 participants) showed vitamin D supplementation does not prevent fractures or falls or have meaningful effects on bone density.",
      methodologyType: "meta-analysis",
      sampleSize: 53537,
      pValue: "0.81",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
    },
    // Aspirin
    {
      topicId: aspirinT.id,
      title: "Effect of Aspirin on Cardiovascular Events and Bleeding in the Healthy Elderly (ASPREE)",
      authors: "McNeil JJ, Wolfe R, Woods RL, et al.",
      journal: "New England Journal of Medicine",
      publicationYear: 2018,
      doi: "10.1056/NEJMoa1805819",
      pmid: "30221597",
      abstract: "RCT of 19,114 healthy adults aged 70+ over median 4.7 years. Aspirin 100mg/day did not significantly reduce cardiovascular events (HR 0.95) but increased major hemorrhage (HR 1.38).",
      methodologyType: "rct",
      sampleSize: 19114,
      pValue: "0.79",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
    },
    {
      topicId: aspirinT.id,
      title: "Aspirin in the primary and secondary prevention of vascular disease: collaborative meta-analysis",
      authors: "Antithrombotic Trialists' Collaboration",
      journal: "The Lancet",
      publicationYear: 2009,
      doi: "10.1016/S0140-6736(09)60503-1",
      pmid: "19482214",
      abstract: "Meta-analysis of 6 primary-prevention trials (95,000 individuals) and 16 secondary-prevention trials (17,000 individuals). Aspirin reduced serious vascular events by 12% in primary prevention but increased major bleeds by 54%.",
      methodologyType: "meta-analysis",
      sampleSize: 112000,
      pValue: "<0.001",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
    },
  ]).returning();

  const [
    coffeeP1, coffeeP2,
    ssriP1, ssriP2,
    statinP1,
    vitDP1, vitDP2,
    aspirinP1, aspirinP2,
  ] = papers;

  console.log("Inserting claims...");
  const claims = await db.insert(claimsTable).values([
    // Coffee/diabetes
    {
      topicId: coffeeT.id,
      paperId: coffeeP1.id,
      claimText: "Habitual coffee consumption is associated with a reduced risk of type 2 diabetes in adults",
      direction: "protective",
      effectSize: 0.91,
      effectSizeUnit: "RR per cup/day",
      ciLower: 0.89,
      ciUpper: 0.94,
      population: "Adults (general population)",
      conditions: "Both caffeinated and decaffeinated coffee show similar effects",
      methodologyType: "meta-analysis",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 7,
    },
    {
      topicId: coffeeT.id,
      paperId: coffeeP2.id,
      claimText: "Moderate coffee consumption (3-5 cups/day) is associated with the lowest cardiovascular disease risk",
      direction: "protective",
      effectSize: 0.85,
      effectSizeUnit: "RR vs no consumption",
      ciLower: 0.80,
      ciUpper: 0.90,
      population: "Adults without prior CVD",
      conditions: "U-shaped dose-response curve; higher consumption attenuates benefit",
      methodologyType: "meta-analysis",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 5,
    },
    {
      topicId: coffeeT.id,
      paperId: coffeeP2.id,
      claimText: "Heavy coffee consumption (>6 cups/day) acutely increases blood pressure in caffeine-naive individuals",
      direction: "harmful",
      effectSize: 8.1,
      effectSizeUnit: "mmHg systolic",
      ciLower: 5.7,
      ciUpper: 10.6,
      population: "Caffeine-naive adults",
      conditions: "Effect attenuates with chronic exposure due to tolerance",
      methodologyType: "rct",
      evidenceQuality: "B",
      replicationStatus: "confirmed",
      nReplications: 4,
    },
    // SSRI
    {
      topicId: ssriT.id,
      paperId: ssriP1.id,
      claimText: "All commonly prescribed antidepressants are more effective than placebo for adults with major depressive disorder",
      direction: "protective",
      effectSize: 1.66,
      effectSizeUnit: "OR for response",
      ciLower: 1.51,
      ciUpper: 1.83,
      population: "Adults with major depressive disorder",
      conditions: "Effect varies substantially by drug; agomelatine, escitalopram and venlafaxine rank highest",
      methodologyType: "meta-analysis",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 8,
    },
    {
      topicId: ssriT.id,
      paperId: ssriP2.id,
      claimText: "Antidepressant-placebo differences are clinically negligible for mild-to-moderate depression",
      direction: "neutral",
      effectSize: 1.80,
      effectSizeUnit: "HAM-D points",
      ciLower: 1.40,
      ciUpper: 2.30,
      population: "Adults with mild-to-moderate depression",
      conditions: "Clinical significance threshold typically set at 3 HAM-D points",
      methodologyType: "meta-analysis",
      evidenceQuality: "B",
      replicationStatus: "partial",
      nReplications: 3,
    },
    // Statins
    {
      topicId: statinT.id,
      paperId: statinP1.id,
      claimText: "Statin therapy reduces major vascular events in primary prevention populations",
      direction: "protective",
      effectSize: 0.79,
      effectSizeUnit: "RR per 1 mmol/L LDL reduction",
      ciLower: 0.77,
      ciUpper: 0.81,
      population: "Adults without prior cardiovascular events",
      conditions: "Benefit consistent across age groups including those over 75",
      methodologyType: "meta-analysis",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 12,
    },
    // Vitamin D
    {
      topicId: vitDT.id,
      paperId: vitDP1.id,
      claimText: "Vitamin D supplementation does not reduce risk of major cardiovascular events in healthy adults",
      direction: "neutral",
      effectSize: 0.97,
      effectSizeUnit: "HR for major CV events",
      ciLower: 0.85,
      ciUpper: 1.12,
      population: "Healthy adults aged 50+",
      conditions: "2000 IU/day supplementation; population was not vitamin D deficient at baseline",
      methodologyType: "rct",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 4,
    },
    {
      topicId: vitDT.id,
      paperId: vitDP2.id,
      claimText: "Vitamin D supplementation does not prevent fractures or falls in community-dwelling adults",
      direction: "neutral",
      effectSize: 1.00,
      effectSizeUnit: "RR for fractures",
      ciLower: 0.93,
      ciUpper: 1.07,
      population: "Community-dwelling adults",
      conditions: "Excludes severely deficient populations and institutional care",
      methodologyType: "meta-analysis",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 6,
    },
    // Aspirin
    {
      topicId: aspirinT.id,
      paperId: aspirinP1.id,
      claimText: "Daily low-dose aspirin does not reduce cardiovascular events in healthy older adults",
      direction: "neutral",
      effectSize: 0.95,
      effectSizeUnit: "HR for CV events",
      ciLower: 0.83,
      ciUpper: 1.08,
      population: "Healthy adults aged 70+",
      conditions: "100 mg enteric-coated daily; no prior CVD",
      methodologyType: "rct",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 3,
    },
    {
      topicId: aspirinT.id,
      paperId: aspirinP2.id,
      claimText: "Daily aspirin substantially increases risk of major bleeding events",
      direction: "harmful",
      effectSize: 1.54,
      effectSizeUnit: "RR for major bleeds",
      ciLower: 1.30,
      ciUpper: 1.82,
      population: "Adults on long-term aspirin therapy",
      conditions: "Risk increases with age; concomitant NSAIDs further elevate risk",
      methodologyType: "meta-analysis",
      evidenceQuality: "A",
      replicationStatus: "confirmed",
      nReplications: 9,
    },
  ]).returning();

  console.log(`Inserted ${claims.length} claims`);

  console.log("Inserting studies & evidence links...");

  // For each claim, create supporting and contradicting studies
  for (const claim of claims) {
    const isProtective = claim.direction === "protective";
    const isNeutral = claim.direction === "neutral";

    // 2-3 supporting studies
    const supportingCount = 2 + Math.floor(Math.random() * 2);
    const contradictingCount = isNeutral ? 1 : 1 + Math.floor(Math.random() * 2);

    const supportingStudies = await db.insert(studiesTable).values(
      Array.from({ length: supportingCount }, (_, i) => ({
        paperId: claim.paperId,
        topicId: claim.topicId,
        title: `Confirmatory analysis of ${claim.claimText.slice(0, 60)}... (Study ${i + 1})`,
        authors: ["Smith J, Chen L, et al.", "Williams R, Park S, et al.", "Anderson K, Lee H, et al."][i % 3],
        publicationYear: 2015 + i * 2,
        methodologyType: ["cohort", "rct", "observational"][i % 3],
        sampleSize: 5000 + Math.floor(Math.random() * 50000),
        effectSize: claim.effectSize ? claim.effectSize * (0.95 + Math.random() * 0.1) : null,
        effectSizeUnit: claim.effectSizeUnit,
        ciLower: claim.ciLower ? claim.ciLower * 0.97 : null,
        ciUpper: claim.ciUpper ? claim.ciUpper * 1.03 : null,
        pValue: ["<0.001", "0.002", "0.01"][i % 3],
        evidenceQuality: ["A", "B", "B"][i % 3],
        population: claim.population,
        preregistered: i % 2,
      }))
    ).returning();

    const contradictingStudies = await db.insert(studiesTable).values(
      Array.from({ length: contradictingCount }, (_, i) => ({
        paperId: claim.paperId,
        topicId: claim.topicId,
        title: `Subgroup analysis showing attenuated effect for ${claim.claimText.slice(0, 50)}...`,
        authors: ["Petrov A, Yamada T, et al.", "O'Brien M, Singh R, et al."][i % 2],
        publicationYear: 2017 + i * 2,
        methodologyType: ["observational", "case-control"][i % 2],
        sampleSize: 800 + Math.floor(Math.random() * 5000),
        effectSize: claim.effectSize ? (isProtective ? claim.effectSize * 1.15 : claim.effectSize * 0.6) : null,
        effectSizeUnit: claim.effectSizeUnit,
        ciLower: null,
        ciUpper: null,
        pValue: ["0.18", "0.42"][i % 2],
        evidenceQuality: ["B", "C"][i % 2],
        population: claim.population + " (subgroup)",
        preregistered: 0,
      }))
    ).returning();

    // Evidence links
    await db.insert(evidenceLinksTable).values([
      ...supportingStudies.map(s => ({
        claimId: claim.id,
        studyId: s.id,
        direction: "supporting",
        contradictionExplanation: null as string | null,
      })),
      ...contradictingStudies.map((s, i) => ({
        claimId: claim.id,
        studyId: s.id,
        direction: "contradicting",
        contradictionExplanation: [
          "Smaller sample size in this subgroup limits statistical power; effect was directionally consistent but did not reach significance.",
          "Observational design with potential for residual confounding; results sensitive to model specification.",
        ][i % 2],
      })),
    ]);

    // Synthesis
    const consensusStatus =
      claim.evidenceQuality === "A" && claim.nReplications >= 5 ? "well-established" :
      claim.evidenceQuality === "A" || claim.evidenceQuality === "B" ? "contested" :
      "preliminary";

    const synthesisText = isProtective
      ? `Strong evidence supports a protective association. Across ${supportingStudies.length + contradictingStudies.length} studies, the effect is directionally consistent though magnitude varies. The pooled estimate of ${claim.effectSize?.toFixed(2)} ${claim.effectSizeUnit ?? ""} is robust to sensitivity analyses.`
      : isNeutral
      ? `Multiple high-quality trials show no clinically meaningful effect. The confidence interval crosses unity and the point estimate is close to no effect. Findings are consistent across populations and replicate well.`
      : `Evidence indicates a harmful or adverse effect. The dose-response relationship is consistent and the magnitude is clinically significant. Heterogeneity exists across subgroups but the overall direction is clear.`;

    await db.insert(claimSynthesisTable).values({
      claimId: claim.id,
      topicId: claim.topicId,
      consensusStatus,
      synthesisText,
      supportingCount: supportingStudies.length,
      contradictingCount: contradictingStudies.length,
      weightedEffectSize: claim.effectSize,
      uncertaintyScore: consensusStatus === "well-established" ? 15 + Math.floor(Math.random() * 15) : consensusStatus === "contested" ? 40 + Math.floor(Math.random() * 25) : 60 + Math.floor(Math.random() * 25),
      moderatingVariables: ["Age", "Baseline risk", "Comorbidities", "Genetic variants"][Math.floor(Math.random() * 4)] + " significantly modify the effect magnitude. Subgroup analyses suggest stronger effects in higher-risk populations.",
      methodologicalConcerns: claim.evidenceQuality === "A"
        ? "Most included trials are well-conducted with low risk of bias. Publication bias appears minimal based on funnel plot symmetry."
        : "Some included studies have moderate risk of bias from non-blinded outcome assessment. Heterogeneity in dose and follow-up duration limits direct comparison.",
      temporalTrend: "Effect estimates have remained stable across studies published over the last decade",
    });
  }

  console.log("Seed complete!");
  await pool.end();
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
