# pyright: reportMissingModuleSource=false
"""PLOD — a public weekly-cadence counter on Algorand TestNet.

If Arcron keepers show up, `tick` fires and the counter moves. That is the
whole experiment.

TRAP: some deploy.py create_args mapped every uint64 to keeper app 769891898
and would freeze a weekly interval at ~68 years (769891898 rounds × ~2.8 s).
Never do that. This contract takes no uint64 create args. The keeper is named
once via `set_keeper(app)`, an explicit admin method. The weekly interval is
chosen at Arcron *register* time, not baked in here. Do not compare the inner
sender against itob(keeper_app.id) — that is 8 bytes, not an address.
"""

from algopy import (
    ARC4Contract,
    Account,
    Application,
    Global,
    GlobalState,
    Txn,
    UInt64,
)
from algopy.arc4 import abimethod


class Plod(ARC4Contract):
    """Weekly heartbeat target for Arcron TestNet keeper 769891898.

    TestNet only. Unaudited. Not a product.
    """

    def __init__(self) -> None:
        self.calls = GlobalState(UInt64(0))
        self.last_round = GlobalState(UInt64(0))
        self.last_caller = GlobalState(Account())
        # App id of the Arcron keeper allowed to drive `tick`. Zero until
        # `set_keeper`. Not an interval. Not a create arg.
        self.keeper_app = GlobalState(UInt64(0))

    @abimethod(create="require")
    def create(self) -> None:
        """No-op create. Zero arguments on purpose.

        A create_arg of type uint64 is how a sloppy deploy script confused the
        keeper app id with a cadence and locked a "week" at ~68 years. There
        is nothing to pass here.
        """
        self.calls.value = UInt64(0)
        self.last_round.value = UInt64(0)
        self.last_caller.value = Account()
        self.keeper_app.value = UInt64(0)

    @abimethod()
    def set_keeper(self, keeper: Application) -> None:
        """Name the Arcron keeper whose app account may call `tick`. Creator only.

        Pass the keeper *application*, not a raw uint64 cadence. Store it once.
        `tick` authorizes Application(keeper).address — the inner-call sender
        when Arcron `execute()` inner-calls this app — never itob(keeper.id).
        """
        assert Txn.sender == Global.creator_address, "Only the creator can set the keeper"
        assert self.keeper_app.value == 0, "Keeper already set"
        assert keeper.id != 0, "Keeper app required"
        self.keeper_app.value = keeper.id

    @abimethod()
    def tick(self) -> UInt64:
        """Arcron hook. Zero arguments; selector is the only app arg.

        Increments `calls` and records `last_round = Global.round`. Authorized
        as Application(keeper_app).address, which is the sender of the inner
        ApplicationCall Arcron `execute()` submits. Anyone else is refused.
        """
        keeper = self.keeper_app.value
        assert keeper != 0, "Keeper not set"
        # Inner-call sender is the keeper *app account*, not itob(keeper.id).
        assert (
            Txn.sender == Application(keeper).address
        ), "Only the keeper app may tick"
        self.calls.value += 1
        self.last_round.value = Global.round
        self.last_caller.value = Txn.sender
        return self.calls.value
