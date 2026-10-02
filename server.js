const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;


// =====================================================
// FIREBASE ADMIN
// =====================================================

if (!admin.apps.length) {

    let serviceAccount;

    try {

        const rawServiceAccount =
            process.env.FIREBASE_SERVICE_ACCOUNT;

        if (!rawServiceAccount) {

            throw new Error(
                "FIREBASE_SERVICE_ACCOUNT environment variable is missing"
            );
        }

        serviceAccount =
            JSON.parse(rawServiceAccount);

        // =================================================
        // IMPORTANT:
        // Render environment variable me \\n ko real newline
        // me convert karna zaroori hai.
        // =================================================

        if (serviceAccount.private_key) {

            serviceAccount.private_key =
                serviceAccount.private_key
                    .replace(/\\n/g, "\n")
                    .replace(/\r/g, "");
        }

        if (
            !serviceAccount.private_key ||
            !serviceAccount.client_email ||
            !serviceAccount.project_id
        ) {

            throw new Error(
                "Firebase service account is incomplete"
            );
        }

    } catch (e) {

        console.error(
            "================================="
        );

        console.error(
            "FIREBASE_SERVICE_ACCOUNT ERROR"
        );

        console.error(
            e.message
        );

        console.error(
            "================================="
        );

        process.exit(1);
    }


    try {

        const databaseURL =
            process.env.FIREBASE_DATABASE_URL;

        if (!databaseURL) {

            throw new Error(
                "FIREBASE_DATABASE_URL environment variable is missing"
            );
        }

        admin.initializeApp({

            credential:
                admin.credential.cert(
                    serviceAccount
                ),

            databaseURL:
                databaseURL
        });

        console.log(
            "================================="
        );

        console.log(
            "Firebase Admin connected"
        );

        console.log(
            "Project:",
            serviceAccount.project_id
        );

        console.log(
            "================================="
        );

    } catch (e) {

        console.error(
            "================================="
        );

        console.error(
            "FIREBASE INITIALIZATION ERROR"
        );

        console.error(
            e
        );

        console.error(
            "================================="
        );

        process.exit(1);
    }
}


const db =
    admin.database();


// =====================================================
// CONFIG
// =====================================================

const BET_DURATION =
    30000;

const SPIN_DURATION =
    5000;

const SHOW_DURATION =
    4000;


// =====================================================
// FOOD
// =====================================================

const FOODS = [

    {
        index: 0,
        key: "apple",
        name: "Apple",
        multiplier: 5
    },

    {
        index: 1,
        key: "mango",
        name: "Mango",
        multiplier: 5
    },

    {
        index: 2,
        key: "strawberry",
        name: "Strawberry",
        multiplier: 5
    },

    {
        index: 3,
        key: "lemon",
        name: "Lemon",
        multiplier: 5
    },

    {
        index: 4,
        key: "fish",
        name: "Fish",
        multiplier: 10
    },

    {
        index: 5,
        key: "burger",
        name: "Burger",
        multiplier: 15
    },

    {
        index: 6,
        key: "pizza",
        name: "Pizza",
        multiplier: 25
    },

    {
        index: 7,
        key: "chicken",
        name: "Chicken",
        multiplier: 45
    }

];


// =====================================================
// TIME
// =====================================================

function now() {

    return Date.now();

}


// =====================================================
// AUTH
// =====================================================

async function verifyUser(req) {

    const authHeader =
        req.headers.authorization || "";

    if (
        !authHeader.startsWith("Bearer ")
    ) {

        throw new Error(
            "Authorization token missing"
        );

    }

    const idToken =
        authHeader.substring(
            7
        ).trim();

    if (!idToken) {

        throw new Error(
            "Invalid authorization token"
        );

    }

    const decodedToken =
        await admin
            .auth()
            .verifyIdToken(
                idToken
            );

    return decodedToken;

}


// =====================================================
// CREATE / GET GLOBAL ROUND
// =====================================================

async function ensureRound() {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );

    const transactionResult =
        await currentRef.transaction(

            current => {

                const time =
                    Date.now();


                // -----------------------------------------
                // Existing active round
                // -----------------------------------------

                if (
                    current &&
                    current.roundId &&
                    Number(current.showEndAt) > time
                ) {

                    return;

                }


                // -----------------------------------------
                // New round
                // -----------------------------------------

                const startAt =
                    time + 1000;

                const betEndAt =
                    startAt +
                    BET_DURATION;

                const spinEndAt =
                    betEndAt +
                    SPIN_DURATION;

                const showEndAt =
                    spinEndAt +
                    SHOW_DURATION;

                const roundId =
                    String(
                        startAt
                    );


                return {

                    roundId,

                    startAt,

                    betEndAt,

                    spinEndAt,

                    showEndAt,

                    winnerIndex:
                        -1,

                    createdAt:
                        time
                };

            }

        );


    let round =
        transactionResult.snapshot.val();


    // =================================================
    // IMPORTANT
    // Transaction can be aborted because another
    // request already created the round.
    // Read current value again.
    // =================================================

    if (!round) {

        const snapshot =
            await currentRef.once(
                "value"
            );

        round =
            snapshot.val();

    }


    // =================================================
    // Save round metadata
    // =================================================

    if (
        round &&
        round.roundId
    ) {

        const roundRef =
            db.ref(
                `food_game_global/rounds/${round.roundId}`
            );

        const existing =
            await roundRef.once(
                "value"
            );

        if (!existing.exists()) {

            await roundRef.set({

                roundId:
                    round.roundId,

                startAt:
                    round.startAt,

                betEndAt:
                    round.betEndAt,

                spinEndAt:
                    round.spinEndAt,

                showEndAt:
                    round.showEndAt,

                winnerIndex:
                    Number(
                        round.winnerIndex ?? -1
                    ),

                createdAt:
                    round.createdAt

            });

        }

    }


    return round;

}


// =====================================================
// GET CURRENT ROUND
// =====================================================

async function getCurrentRound() {

    const snapshot =
        await db.ref(
            "food_game_global/current"
        ).once(
            "value"
        );

    let round =
        snapshot.val();


    if (
        !round ||
        !round.roundId
    ) {

        round =
            await ensureRound();

    }


    return round;

}


// =====================================================
// CHOOSE SERVER WINNER
// =====================================================

async function chooseWinner(
    roundId
) {

    const currentWinnerRef =
        db.ref(
            "food_game_global/current/winnerIndex"
        );


    const result =
        await currentWinnerRef.transaction(

            current => {

                if (
                    typeof current === "number" &&
                    current >= 0 &&
                    current <= 7
                ) {

                    return;

                }


                // =========================================
                // WEIGHTED WINNER
                // =========================================
                //
                // Apple       20%
                // Mango       20%
                // Strawberry  20%
                // Lemon       20%
                // Fish         8%
                // Burger       5%
                // Pizza        4%
                // Chicken      3%
                //
                // =========================================

                const roll =
                    Math.floor(
                        Math.random() * 100
                    );

                let winner;


                if (roll < 20) {

                    winner = 0;

                } else if (roll < 40) {

                    winner = 1;

                } else if (roll < 60) {

                    winner = 2;

                } else if (roll < 80) {

                    winner = 3;

                } else if (roll < 88) {

                    winner = 4;

                } else if (roll < 93) {

                    winner = 5;

                } else if (roll < 97) {

                    winner = 6;

                } else {

                    winner = 7;

                }


                return winner;

            }

        );


    const winnerIndex =
        Number(
            result.snapshot.val()
        );


    // =================================================
    // IMPORTANT:
    // Save winner permanently inside historical round.
    // =================================================

    if (
        roundId &&
        winnerIndex >= 0 &&
        winnerIndex <= 7
    ) {

        await db.ref(
            `food_game_global/rounds/${roundId}/winnerIndex`
        ).set(
            winnerIndex
        );

    }


    return winnerIndex;

}


// =====================================================
// PROCESS ROUND
// =====================================================

async function processRound() {

    try {

        let round =
            await getCurrentRound();


        if (!round) {

            return;

        }


        const currentTime =
            Date.now();


        // =================================================
        // BETTING CLOSED
        // =================================================

        if (
            currentTime >=
            Number(round.betEndAt) &&
            Number(round.winnerIndex) === -1
        ) {

            const winner =
                await chooseWinner(
                    round.roundId
                );


            console.log(
                "ROUND:",
                round.roundId
            );

            console.log(
                "WINNER:",
                winner
            );


            // ---------------------------------------------
            // Refresh current round
            // ---------------------------------------------

            round =
                await getCurrentRound();

        }


        // =================================================
        // ROUND FINISHED
        // =================================================

        if (
            currentTime >=
            Number(round.showEndAt)
        ) {

            await ensureRound();

        }

    } catch (error) {

        console.error(
            "processRound error:",
            error
        );

    }

}


// =====================================================
// BACKGROUND ROUND LOOP
// =====================================================

setInterval(
    processRound,
    500
);


// =====================================================
// TEST
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            success:
                true,

            server:
                "vibecash-food-server",

            status:
                "online"

        });

    }
);


// =====================================================
// HEALTH
// =====================================================

app.get(
    "/health",
    (req, res) => {

        res.json({

            success:
                true,

            status:
                "ok",

            time:
                Date.now()

        });

    }
);


// =====================================================
// GAME STATE
// =====================================================

app.get(
    "/game/state",
    async (req, res) => {

        try {

            const round =
                await getCurrentRound();


            if (!round) {

                return res.status(500).json({

                    success:
                        false,

                    error:
                        "Round unavailable"

                });

            }


            const time =
                Date.now();


            let phase =
                "waiting";


            if (
                time >=
                Number(round.startAt) &&

                time <
                Number(round.betEndAt)
            ) {

                phase =
                    "betting";


            } else if (
                time >=
                Number(round.betEndAt) &&

                time <
                Number(round.spinEndAt)
            ) {

                phase =
                    "spin";


            } else if (
                time >=
                Number(round.spinEndAt) &&

                time <
                Number(round.showEndAt)
            ) {

                phase =
                    "result";


            } else if (
                time >=
                Number(round.showEndAt)
            ) {

                phase =
                    "finished";

            }


            res.json({

                success:
                    true,

                serverTime:
                    time,

                phase,

                round

            });


        } catch (error) {

            console.error(
                "STATE ERROR:",
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get game state"

            });

        }

    }
);


// =====================================================
// PLACE BET
// =====================================================

app.post(
    "/game/bet",
    async (req, res) => {

        try {

            // =============================================
            // VERIFY FIREBASE USER
            // =============================================

            const decodedUser =
                await verifyUser(
                    req
                );


            const uid =
                decodedUser.uid;


            const {
                food,
                amount
            } = req.body;


            // =============================================
            // VALIDATION
            // =============================================

            if (
                !food ||
                amount === undefined ||
                amount === null
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "food and amount required"

                });

            }


            const betAmount =
                Number(
                    amount
                );


            if (
                !Number.isFinite(
                    betAmount
                ) ||

                betAmount <= 0 ||

                !Number.isInteger(
                    betAmount
                )
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Invalid amount"

                });

            }


            const foodData =
                FOODS.find(
                    item =>
                        item.key === food
                );


            if (!foodData) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Invalid food"

                });

            }


            // =============================================
            // CURRENT ROUND
            // =============================================

            const round =
                await getCurrentRound();


            if (!round) {

                return res.status(500).json({

                    success:
                        false,

                    error:
                        "Round unavailable"

                });

            }


            const currentTime =
                Date.now();


            if (
                currentTime <
                Number(round.startAt)
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Round not started"

                });

            }


            if (
                currentTime >=
                Number(round.betEndAt)
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Betting closed"

                });

            }


            // =============================================
            // DEDUCT DIAMONDS
            // =============================================

            const diamondRef =
                db.ref(
                    `users/${uid}/diamonds`
                );


            const diamondResult =
                await diamondRef.transaction(

                    current => {

                        const diamonds =
                            Number(
                                current || 0
                            );


                        if (
                            diamonds <
                            betAmount
                        ) {

                            return;

                        }


                        return (
                            diamonds -
                            betAmount
                        );

                    }

                );


            if (
                !diamondResult.committed
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Not enough diamonds"

                });

            }


            // =============================================
            // SAVE BET
            // =============================================

            try {

                const betRef =
                    db.ref(
                        `food_game_global/rounds/${round.roundId}/bets/${uid}/${foodData.key}`
                    );


                await betRef.transaction(

                    current => {

                        return (
                            Number(
                                current || 0
                            ) +
                            betAmount
                        );

                    }

                );

            } catch (betError) {

                // =========================================
                // BET SAVE FAILED
                // REFUND USER
                // =========================================

                await diamondRef.transaction(

                    current => {

                        return (
                            Number(
                                current || 0
                            ) +
                            betAmount
                        );

                    }

                );


                throw betError;

            }


            // =============================================
            // GET NEW BALANCE
            // =============================================

            const balanceSnapshot =
                await diamondRef.once(
                    "value"
                );


            const newBalance =
                Number(
                    balanceSnapshot.val() || 0
                );


            // =============================================
            // RESPONSE
            // =============================================

            res.json({

                success:
                    true,

                uid,

                roundId:
                    round.roundId,

                food:
                    foodData.key,

                amount:
                    betAmount,

                multiplier:
                    foodData.multiplier,

                possibleWin:
                    betAmount *
                    foodData.multiplier,

                diamonds:
                    newBalance

            });


        } catch (error) {

            console.error(
                "BET ERROR:",
                error
            );


            res.status(401).json({

                success:
                    false,

                error:
                    error.message ||
                    "Bet failed"

            });

        }

    }
);


// =====================================================
// SETTLE USER
// =====================================================

app.post(
    "/game/settle",
    async (req, res) => {

        try {

            // =============================================
            // VERIFY USER
            // =============================================

            const decodedUser =
                await verifyUser(
                    req
                );


            const uid =
                decodedUser.uid;


            const {
                roundId
            } = req.body;


            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "roundId required"

                });

            }


            // =============================================
            // HISTORICAL ROUND
            // =============================================

            const roundSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}`
                ).once(
                    "value"
                );


            const roundData =
                roundSnapshot.val();


            if (!roundData) {

                return res.status(404).json({

                    success:
                        false,

                    error:
                        "Round not found"

                });

            }


            const winnerIndex =
                Number(
                    roundData.winnerIndex
                );


            if (
                winnerIndex < 0 ||
                winnerIndex > 7
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Winner not available"

                });

            }


            const foodData =
                FOODS[
                    winnerIndex
                ];


            // =============================================
            // USER WINNING BET
            // =============================================

            const userBetSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/bets/${uid}/${foodData.key}`
                ).once(
                    "value"
                );


            const winningBet =
                Number(
                    userBetSnapshot.val() || 0
                );


            const payout =
                winningBet *
                foodData.multiplier;


            // =============================================
            // SETTLEMENT REF
            // =============================================

            const settlementRef =
                db.ref(
                    `food_game_global/rounds/${roundId}/settlements/${uid}`
                );


            // =============================================
            // CHECK EXISTING SETTLEMENT
            // =============================================

            const existingSettlement =
                await settlementRef.once(
                    "value"
                );


            if (
                existingSettlement.exists()
            ) {

                const old =
                    existingSettlement.val() || {};


                // -----------------------------------------
                // Already paid
                // -----------------------------------------

                if (
                    old.status === "paid"
                ) {

                    return res.json({

                        success:
                            true,

                        alreadySettled:
                            true,

                        payout:
                            Number(
                                old.payout || 0
                            ),

                        food:
                            old.food ||
                            foodData.name

                    });

                }

            }


            // =============================================
            // LOCK SETTLEMENT
            // =============================================

            const settlementResult =
                await settlementRef.transaction(

                    current => {

                        if (
                            current &&
                            (
                                current.status ===
                                "processing" ||

                                current.status ===
                                "paid"
                            )
                        ) {

                            return;

                        }


                        return {

                            status:
                                "processing",

                            uid,

                            payout,

                            food:
                                foodData.name,

                            createdAt:
                                Date.now()

                        };

                    }

                );


            // =============================================
            // SOMEONE ELSE ALREADY SETTLED
            // =============================================

            if (
                !settlementResult.committed
            ) {

                const old =
                    settlementResult.snapshot.val() || {};


                // -----------------------------------------
                // If another request is currently processing,
                // return safely. Client can retry.
                // -----------------------------------------

                if (
                    old.status ===
                    "processing"
                ) {

                    return res.json({

                        success:
                            true,

                        processing:
                            true,

                        payout:
                            Number(
                                old.payout || 0
                            ),

                        food:
                            old.food ||
                            foodData.name

                    });

                }


                return res.json({

                    success:
                        true,

                    alreadySettled:
                        true,

                    payout:
                        Number(
                            old.payout || 0
                        ),

                    food:
                        old.food ||
                        foodData.name

                });

            }


            // =============================================
            // PAYOUT
            // =============================================

            if (
                payout > 0
            ) {

                await db.ref(
                    `users/${uid}/diamonds`
                ).transaction(

                    current => {

                        return (
                            Number(
                                current || 0
                            ) +
                            payout
                        );

                    }

                );


                // =========================================
                // TODAY WIN
                // =========================================

                const todayRef =
                    db.ref(
                        `users/${uid}/food_game_today`
                    );


                await todayRef.transaction(

                    current => {

                        const old =
                            current || {};


                        const today =
                            getIndiaDate();


                        let oldWin =
                            0;


                        // ---------------------------------
                        // Reset previous day
                        // ---------------------------------

                        if (
                            old.date !==
                            today
                        ) {

                            oldWin =
                                0;

                        } else {

                            oldWin =
                                Number(
                                    old.win || 0
                                );

                        }


                        return {

                            date:
                                today,

                            win:
                                oldWin +
                                payout

                        };

                    }

                );

            }


            // =============================================
            // USER PROFILE
            // =============================================

            const userSnapshot =
                await db.ref(
                    `users/${uid}`
                ).once(
                    "value"
                );


            const userData =
                userSnapshot.val() || {};


            const name =
                userData.name ||
                userData.user_name ||
                userData.username ||
                "User";


            const profileImage =
                userData.profile_pic ||
                userData.profile_image ||
                userData.profileImage ||
                "";


            // =============================================
            // SAVE ROUND RESULT
            // =============================================

            await db.ref(
                `food_game_global/rounds/${roundId}/results/${uid}`
            ).set({

                uid,

                name,

                profile_image:
                    profileImage,

                win:
                    payout,

                food:
                    foodData.name,

                round:
                    roundId,

                time:
                    Date.now()

            });


            // =============================================
            // MARK SETTLEMENT PAID
            // =============================================

            await settlementRef.update({

                status:
                    "paid",

                paidAt:
                    Date.now()

            });


            // =============================================
            // CURRENT BALANCE
            // =============================================

            const balanceSnapshot =
                await db.ref(
                    `users/${uid}/diamonds`
                ).once(
                    "value"
                );


            const balance =
                Number(
                    balanceSnapshot.val() || 0
                );


            // =============================================
            // RESPONSE
            // =============================================

            res.json({

                success:
                    true,

                alreadySettled:
                    false,

                payout,

                food:
                    foodData.name,

                multiplier:
                    foodData.multiplier,

                diamonds:
                    balance

            });


        } catch (error) {

            console.error(
                "SETTLE ERROR:",
                error
            );


            res.status(401).json({

                success:
                    false,

                error:
                    error.message ||
                    "Settlement failed"

            });

        }

    }
);


// =====================================================
// CURRENT ROUND RESULTS
// =====================================================

app.get(
    "/game/results/:roundId",
    async (req, res) => {

        try {

            const roundId =
                req.params.roundId;


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            res.json({

                success:
                    true,

                roundId,

                results:
                    snapshot.val() || {}

            });


        } catch (error) {

            console.error(
                "RESULTS ERROR:",
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    "Unable to load results"

            });

        }

    }
);


// =====================================================
// TOP 3 CURRENT ROUND
// =====================================================

app.get(
    "/game/top3/:roundId",
    async (req, res) => {

        try {

            const roundId =
                req.params.roundId;


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            const data =
                snapshot.val() || {};


            const list =
                Object.values(
                    data
                )
                .filter(

                    item =>
                        Number(
                            item.win || 0
                        ) > 0

                )
                .sort(

                    (a, b) =>
                        Number(
                            b.win || 0
                        ) -
                        Number(
                            a.win || 0
                        )

                )
                .slice(
                    0,
                    3
                );


            res.json({

                success:
                    true,

                roundId,

                top3:
                    list

            });


        } catch (error) {

            console.error(
                "TOP3 ERROR:",
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    "Unable to load top 3"

            });

        }

    }
);


// =====================================================
// INDIA DATE
// =====================================================

function getIndiaDate() {

    return new Intl.DateTimeFormat(

        "en-CA",

        {

            timeZone:
                "Asia/Kolkata",

            year:
                "numeric",

            month:
                "2-digit",

            day:
                "2-digit"

        }

    ).format(
        new Date()
    );

}


// =====================================================
// START SERVER
// =====================================================

app.listen(

    PORT,

    "0.0.0.0",

    () => {

        console.log(
            "================================="
        );

        console.log(
            "VibeCash Food Server ONLINE"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "================================="
        );

    }

);
