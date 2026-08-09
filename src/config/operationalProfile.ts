export interface OperationalProfile {
  edition: "public-demo" | "private-operational";
  brand: {
    name: string;
    legalName: string;
    address: string;
    phone: string;
    website: string;
  };
  seedPolicy: {
    catalogNamesAndCategories: boolean;
    economicValues: boolean;
    peopleAndContacts: boolean;
    namedCouriersAndAccounts: boolean;
  };
}

export const PUBLIC_OPERATIONAL_PROFILE: OperationalProfile = {
  edition: "public-demo",
  brand: {
    name: "PharmaTek",
    legalName: "",
    address: "",
    phone: "",
    website: "",
  },
  seedPolicy: {
    catalogNamesAndCategories: true,
    economicValues: false,
    peopleAndContacts: false,
    namedCouriersAndAccounts: false,
  },
};
