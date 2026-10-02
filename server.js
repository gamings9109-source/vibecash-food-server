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

        serviceAccount =
            JSON.parse(
                process.env.FIREBASE_SERVICE_ACCOUNT
            );

    } catch (e) {

        console.error(
            "FIREBASE_SERVICE_ACCOUNT JSON ERROR"
        );

        console.error(e);

        process.exit(1);
    }

    admin.initializeApp({
        credential:
            admin.credential.cert(
                serviceAccount
            ),

        databaseURL:
            process.env.FIREBASE_DATABASE_URL
    });
}

const db =
    admin.database();


// =====================================================
// CONFIG
// =====================================================

const BET_DURATION = 30000;
const SPIN_DURATION = 5000;
const SHOW_DURATION = 4000;


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
// CREATE / GET GLOBAL ROUND
// =====================================================

async function ensureRound() {

    const ref =
        db.ref(
            "food_game_global/current"
        );

    const result =
        await ref.transaction(
            current => {

                const time =
                    Date.now();

                if (
                    current &&
                    current.roundId &&
                    current.showEndAt &&
                    current.showEndAt > time
                ) {

                    return;
                }

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
                    String(startAt);

                return {

                    roundId,

                    startAt,

                    betEndAt,

                    spinEndAt,

                    showEndAt,

                    winnerIndex: -1,

                    createdAt: time
                };
            }
        );

    return result.snapshot.val();
}


// =====================================================
// GET CURRENT ROUND
// =====================================================

async function getCurrentRound() {

    const snapshot =
        await db.ref(
            "food_game_global/current"
        ).once("value");

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

async function chooseWinner() {

    const ref =
        db.ref(
            "food_game_global/current/winnerIndex"
        );

    const result =
        await ref.transaction(
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

    return result.snapshot.val();
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

        // =========================================
        // BETTING CLOSED
        // =========================================

        if (
            currentTime >= round.betEndAt &&
            round.winnerIndex === -1
        ) {

            const winner =
                await chooseWinner();

            console.log(
                "WINNER:",
                winner
            );

            round =
                await getCurrentRound();
        }

        // =========================================
        // ROUND FINISHED
        // =========================================

        if (
            currentTime >= round.showEndAt
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
// TEST ROUTE
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            success: true,

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

            success: true,

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

            const time =
                Date.now();

            let phase =
                "waiting";

            if (
                time >= round.startAt &&
                time < round.betEndAt
            ) {

                phase =
                    "betting";

            } else if (
                time >= round.betEndAt &&
                time < round.spinEndAt
            ) {

                phase =
                    "spin";

            } else if (
                time >= round.spinEndAt &&
                time < round.showEndAt
            ) {

                phase =
                    "result";

            } else if (
                time >= round.showEndAt
            ) {

                phase =
                    "finished";
            }

            res.json({

                success: true,

                serverTime:
                    time,

                phase,

                round: round
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

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

            const {
                uid,
                food,
                amount
            } = req.body;

            // =========================================
            // VALIDATION
            // =========================================

            if (
                !uid ||
                !food ||
                !amount
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "uid, food and amount required"
                });
            }

            const betAmount =
                Number(amount);

            if (
                !Number.isFinite(
                    betAmount
                ) ||
                betAmount <= 0
            ) {

                return res.status(400).json({

                    success: false,

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

                    success: false,

                    error:
                        "Invalid food"
                });
            }

            // =========================================
            // CURRENT ROUND
            // =========================================

            const round =
                await getCurrentRound();

            const currentTime =
                Date.now();

            if (
                currentTime <
                round.startAt
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Round not started"
                });
            }

            if (
                currentTime >=
                round.betEndAt
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Betting closed"
                });
            }

            // =========================================
            // DEDUCT DIAMONDS
            // =========================================

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

                    success: false,

                    error:
                        "Not enough diamonds"
                });
            }

            // =========================================
            // SAVE BET
            // =========================================

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

            // =========================================
            // RESPONSE
            // =========================================

            res.json({

                success: true,

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
                    foodData.multiplier
            });

        } catch (error) {

            console.error(
                "BET ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                error:
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

            const {
                uid,
                roundId
            } = req.body;

            if (
                !uid ||
                !roundId
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "uid and roundId required"
                });
            }

            const currentRound =
                await getCurrentRound();

            let roundSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}`
                ).once("value");

            const roundData =
                roundSnapshot.val() || {};

            const winnerIndex =
                Number(
                    currentRound.roundId === roundId
                        ? currentRound.winnerIndex
                        : roundData.winnerIndex
                );

            // =========================================
            // WINNER
            // =========================================

            let finalWinner =
                winnerIndex;

            if (
                finalWinner < 0 ||
                finalWinner > 7
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Winner not available"
                });
            }

            const foodData =
                FOODS[finalWinner];

            // =========================================
            // USER BET
            // =========================================

            const userBetSnapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/bets/${uid}/${foodData.key}`
                ).once("value");

            const winningBet =
                Number(
                    userBetSnapshot.val() || 0
                );

            const payout =
                winningBet *
                foodData.multiplier;

            // =========================================
            // SETTLEMENT TRANSACTION
            // =========================================

            const settlementRef =
                db.ref(
                    `food_game_global/rounds/${roundId}/settlements/${uid}`
                );

            const settlementResult =
                await settlementRef.transaction(
                    current => {

                        if (
                            current
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

            // Already settled
            if (
                !settlementResult.committed
            ) {

                const old =
                    settlementResult.snapshot.val();

                return res.json({

                    success: true,

                    alreadySettled: true,

                    payout:
                        Number(
                            old?.payout || 0
                        ),

                    food:
                        old?.food ||
                        foodData.name
                });
            }

            // =========================================
            // PAYOUT
            // =========================================

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

                // =====================================
                // TODAY WIN
                // =====================================

                await db.ref(
                    `users/${uid}/food_game_today`
                ).transaction(
                    current => {

                        const old =
                            current || {};

                        return {

                            date:
                                getIndiaDate(),

                            win:
                                Number(
                                    old.win || 0
                                ) +
                                payout
                        };
                    }
                );
            }

            // =========================================
            // SAVE RESULT
            // =========================================

            let userSnapshot =
                await db.ref(
                    `users/${uid}`
                ).once("value");

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

            // =========================================
            // MARK PAID
            // =========================================

            await settlementRef.update({

                status:
                    "paid",

                paidAt:
                    Date.now()
            });

            res.json({

                success: true,

                alreadySettled:
                    false,

                payout,

                food:
                    foodData.name,

                multiplier:
                    foodData.multiplier
            });

        } catch (error) {

            console.error(
                "SETTLE ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                error:
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
                ).once("value");

            res.json({

                success: true,

                roundId,

                results:
                    snapshot.val() || {}
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

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
                ).once("value");

            const data =
                snapshot.val() || {};

            const list =
                Object.values(data)
                    .filter(
                        item =>
                            Number(
                                item.win || 0
                            ) > 0
                    )
                    .sort(
                        (a, b) =>
                            Number(b.win || 0) -
                            Number(a.win || 0)
                    )
                    .slice(0, 3);

            res.json({

                success: true,

                roundId,

                top3:
                    list
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

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
